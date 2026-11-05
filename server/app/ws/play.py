"""The game socket: one browser ↔ this server ↔ Prisma (STT) and Timbre (TTS).

The browser never talks to Gnani. It authenticates with a session token, streams mic PCM only
while the server says it is listening, and receives question audio as tagged PCM frames. All
timing, answer judging and scoring happen here, so the leaderboard can't be forged from the
client. See docs/PROTOCOL.md for the wire format.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import secrets
import struct
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from starlette.websockets import WebSocket, WebSocketDisconnect, WebSocketState

from app.deps import Deps
from app.game import scoring
from app.game.characters import valid_character
from app.game.languages import (
    DEFAULT_WIZARD,
    LANGUAGES,
    VOICE_GAIN_DB,
    LanguageRoute,
    route_for_game,
    route_for_wizard,
    valid_wizard,
)
from app.game.matching import looks_like_echo, match_answer, normalize, pack_answer_index
from app.game.packs import Pack, Question
from app.gnani.errors import GnaniAuthError, GnaniError
from app.gnani.stt import SttStream
from app.gnani.tts import TTS_SAMPLE_RATE, TtsStreamer
from app.logging import get_logger
from app.security.client_ip import hash_ip, resolve_client_ip
from app.security.http import origin_allowed
from app.security.ratelimit import day_key, seconds_until_ist_midnight
from app.security.tokens import ScoreClaims, SessionClaims, TokenError
from app.voice.cache import cache_key
from app.voice.gain import Gain
from app.voice.vad import BargeInDetector
from app.ws.adventure import AdventureRunner, LimitReached

log = get_logger(__name__)

PROTOCOL = "maata.v1"
MIC_SAMPLE_RATE = 16000
MIC_BYTES_PER_S = MIC_SAMPLE_RATE * 2
TTS_BYTES_PER_S = TTS_SAMPLE_RATE * 2
AUDIO_CHUNK_BYTES = 9600  # 200 ms of 24 kHz PCM16 per binary frame
AUDIO_FRAME_MAGIC = 0x41
IDLE_TIMEOUT_S = 120.0
MAX_PROTOCOL_STRIKES = 20
AUDIO_FLUSH_S = 0.5
# The client schedules each audio chunk at max(end of the previous chunk, now + its start
# delay); the extra margin covers the network between our send and its arrival.
PLAYOUT_LEAD_S = 0.06 + 0.25
# Shown (in the player's language) by the client when a player reaches the daily play cap.
AUDIO_LIMIT_NOTE = (
    "Thanks for playing! Credits are limited, so everyone gets a fair turn today. "
    "We'll raise the limit soon; share the game with your friends."
)
# The longest a game waits, after game_over, for its last line to finish streaming.
LAST_LINE_TIMEOUT_S = 20.0

# Close codes (4000-4999 are application-defined).
CLOSE_PROTOCOL = 4400
CLOSE_AUTH = 4401
CLOSE_ORIGIN = 4403
CLOSE_DUPLICATE = 4409
CLOSE_IDLE = 4408
CLOSE_LIMIT = 4429
CLOSE_UNAVAILABLE = 4503


class SessionEnded(Exception):
    """Stop the session; the reason has already been sent to the client."""


class RoundSkipped(Exception):
    """A provider failure voided this question; it is neither right nor wrong."""


@dataclass
class GameState:
    game_id: str
    pack: Pack
    lang: LanguageRoute
    questions: list[Question]
    score: int = 0
    correct: int = 0
    streak: int = 0
    answered: int = 0
    misses: int = 0
    options: dict[str, list[str]] = field(default_factory=dict)
    character: str = "arjun"
    distractors: dict[str, frozenset[str]] = field(default_factory=dict)


class Playout:
    """Estimates when the client will have finished playing a line.

    Audio is heard only once it reaches the client, so a line ends at "start + length" only
    when it was cached. A live line starts after Timbre's first chunk, and if Timbre streams
    slower than real time the client's queue runs dry and playback stretches. This mirrors the
    client's scheduling (client/src/audio/player.ts) chunk by chunk, so the next caption is
    not shown, and the answer timer does not start, while the wizard is still talking."""

    def __init__(self) -> None:
        self.ends_at = time.monotonic()

    def sent(self, nbytes: int) -> None:
        start = max(self.ends_at, time.monotonic() + PLAYOUT_LEAD_S)
        self.ends_at = start + nbytes / TTS_BYTES_PER_S


@dataclass
class _Speech:
    utterance: int
    started: float
    task: asyncio.Task[float]
    playout: Playout = field(default_factory=Playout)
    interrupted_at: float | None = None
    extra: dict[str, Any] = field(default_factory=dict)


def audio_frame(utterance: int, pcm: bytes, last: bool) -> bytes:
    return struct.pack(">BHB", AUDIO_FRAME_MAGIC, utterance & 0xFFFF, 1 if last else 0) + pcm


class PlaySession:
    def __init__(self, ws: WebSocket, deps: Deps) -> None:
        self.ws = ws
        self.deps = deps
        self.s = deps.settings
        ip = resolve_client_ip(ws, self.s.trusted_proxies)
        self.ip_hash = hash_ip(ip, self.s.ip_hash_secret.get_secret_value())
        self.owner = secrets.token_hex(8)
        self.claims: SessionClaims | None = None

        self._send_lock = asyncio.Lock()
        self._commands: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=4)
        self._gone = asyncio.Event()
        self._receiver: asyncio.Task[None] | None = None
        self._heartbeat: asyncio.Task[None] | None = None
        self._strikes = 0
        self._closing = False
        self._fail_task: asyncio.Task[None] | None = None
        self._msg_window = (0.0, 0)

        self._listening = False
        self._stt: SttStream | None = None
        self._tts: TtsStreamer | None = None
        self._speech: _Speech | None = None
        self._utterance = 0
        self._vad = BargeInDetector(sample_rate=MIC_SAMPLE_RATE)
        self._game: GameState | None = None
        self._lang: LanguageRoute | None = None  # voice of the game in progress
        self._adventure_game = False

        self._audio_pending = 0.0
        self._limit_reason: str | None = None

    # ------------------------------------------------------------------ entry point --
    async def run(self) -> None:
        if not await self._handshake():
            return
        try:
            self.claims = await self._authenticate()
            if not await self.deps.slots.lock_session(self.claims.session_id, self.owner):
                await self._fail(
                    "already_connected", "This game is open in another tab.", CLOSE_DUPLICATE
                )
                return
            self._receiver = asyncio.create_task(self._receive_loop(), name="ws-recv")
            self._heartbeat = asyncio.create_task(self._heartbeat_loop(), name="ws-heartbeat")
            await self._send(
                {"type": "ready", "protocol": PROTOCOL, "max_games": self.s.max_games_per_session}
            )
            await self._lobby()
        except (SessionEnded, WebSocketDisconnect):
            pass
        except Exception:
            log.exception("session_crashed")
            with contextlib.suppress(Exception):
                await self._fail("internal", "Something went wrong. Please reload.", 1011)
        finally:
            await self._cleanup()

    async def _handshake(self) -> bool:
        origin = self.ws.headers.get("origin")
        if not origin_allowed(origin, self.s.allowed_origins):
            log.warning("ws_origin_rejected", ip_hash=self.ip_hash)
            await self.ws.close(code=CLOSE_ORIGIN)
            return False
        limit = await self.deps.limiter.hit("ws", self.ip_hash, self.s.rate_ws_connect_per_min)
        if not limit.allowed:
            await self.ws.close(code=CLOSE_LIMIT)
            return False
        offered = self.ws.scope.get("subprotocols") or []
        if PROTOCOL not in offered:
            await self.ws.close(code=CLOSE_PROTOCOL)
            return False
        await self.ws.accept(subprotocol=PROTOCOL)
        return True

    async def _authenticate(self) -> SessionClaims:
        try:
            raw = await asyncio.wait_for(self.ws.receive_text(), timeout=self.s.auth_timeout_s)
            if len(raw) > self.s.max_control_msg_bytes:
                raise ValueError("oversized")
            msg = json.loads(raw)
            if msg.get("type") != "auth":
                raise ValueError("expected auth")
            return self.deps.tokens.verify_session(msg.get("token", ""))
        except (TimeoutError, ValueError, KeyError, TypeError, TokenError, AttributeError) as exc:
            log.info("ws_auth_failed", reason=type(exc).__name__, ip_hash=self.ip_hash)
            await self._fail("unauthorized", "Session expired. Please start again.", CLOSE_AUTH)
            raise SessionEnded from exc

    # ------------------------------------------------------------------ lobby ----------
    async def _lobby(self) -> None:
        assert self.claims is not None
        while True:
            cmd = await self._next_command(IDLE_TIMEOUT_S)
            if cmd is None:
                await self._fail("idle", "Closed after being idle.", CLOSE_IDLE)
                return
            if cmd["type"] == "start_adventure":
                await self._start_adventure(cmd)
                continue
            if cmd["type"] != "start":
                continue
            pack = self.deps.packs.get(str(cmd.get("pack_id", "")))
            if pack is None:
                await self._send_error("unknown_pack", "That question pack is not available.")
                continue
            character = valid_character(cmd.get("character"))
            if character is None:
                await self._send_error("unknown_character", "Pick one of the heroes on screen.")
                continue
            picked = cmd.get("wizard")
            wizard = DEFAULT_WIZARD if picked is None else valid_wizard(picked)
            if wizard is None:
                await self._send_error("unknown_character", "Pick one of the wizards on screen.")
                continue
            game_id = await self._claim_game()
            if game_id is None:
                continue
            try:
                await self._play_game(game_id, pack, character, wizard)
            finally:
                await self.deps.slots.release_game(game_id)

    async def _claim_game(self) -> str | None:
        """Budget, per-session game cap and a global game slot; None if the game can't start.
        Raises SessionEnded when the session itself is over."""
        assert self.claims is not None
        if not await self._check_open():
            raise SessionEnded
        games_key = f"maata:games:{self.claims.session_id}"
        played = await self.deps.redis.incr(games_key)
        if played == 1:
            await self.deps.redis.expire(games_key, self.s.session_ttl_s + 60)
        if played > self.s.max_games_per_session:
            await self._fail(
                "session_limit",
                "That's the most games for one session. Reload to play again.",
                CLOSE_LIMIT,
            )
            raise SessionEnded
        game_id = secrets.token_urlsafe(12)
        if not await self.deps.slots.acquire_game(game_id):
            await self._send_error("busy", "Lots of players right now. Try again in a minute.")
            return None
        return game_id

    async def _start_adventure(self, cmd: dict[str, Any]) -> None:
        library = self.deps.adventures
        language = cmd.get("language")
        if not isinstance(language, str) or language not in LANGUAGES:
            await self._send_error("unknown_language", "Pick one of the languages on screen.")
            return
        wanted = cmd.get("adventure")
        adventure = (
            library.prologue
            if wanted == "auto"
            else library.get(wanted)
            if isinstance(wanted, str)
            else None
        )
        if adventure is None:
            await self._send_error("unknown_adventure", "That adventure is not available.")
            return
        character = valid_character(cmd.get("character"))
        if character is None:
            await self._send_error("unknown_character", "Pick one of the heroes on screen.")
            return
        picked = cmd.get("wizard")
        wizard = DEFAULT_WIZARD if picked is None else valid_wizard(picked)
        if wizard is None:
            await self._send_error("unknown_character", "Pick one of the wizards on screen.")
            return
        game_id = await self._claim_game()
        if game_id is None:
            return
        lang = route_for_wizard(language, wizard)
        self._lang = lang
        self._tts = self.deps.new_tts()
        log.info("adventure_started", game_id=game_id, adventure=adventure.id, language=language)
        try:
            try:
                await AdventureRunner(self, lang).run(game_id, adventure, wizard, character)
            except LimitReached:
                pass
            if self._limit_reason:
                await self._fail("audio_limit", AUDIO_LIMIT_NOTE, CLOSE_LIMIT)
                raise SessionEnded
        finally:
            await self.deps.slots.release_game(game_id)
            await self._end_tts()
            self._lang = None

    async def _end_tts(self) -> None:
        """Close the game's TTS once its last line (often spoken without waiting, right before
        game_over) has finished streaming, so that line is neither cut off nor left unsaid."""
        speech = self._speech
        if speech is not None and not speech.task.done() and not self._gone.is_set():
            await asyncio.wait({speech.task}, timeout=LAST_LINE_TIMEOUT_S)
        tts, self._tts = self._tts, None
        if tts is not None:
            await tts.close()

    async def _check_open(self) -> bool:
        status = await self.deps.budget.status()
        if status.open:
            return True
        await self._fail(
            "closed_for_today",
            "Mic Drop Arcade has hit today's limit. Come back tomorrow!",
            CLOSE_UNAVAILABLE,
        )
        return False

    # ------------------------------------------------------------------ game -----------
    async def _play_game(self, game_id: str, pack: Pack, character: str, wizard: str) -> None:
        lang = route_for_game(pack, wizard)
        rng = secrets.SystemRandom()
        n = min(self.s.questions_per_game, len(pack.questions))
        game = GameState(game_id, pack, lang, rng.sample(pack.questions, n))
        game.distractors = pack_answer_index(list(pack.questions))
        for q in game.questions:
            if q.options:
                # Saying one of the wrong on-screen options is wrong, even alongside the right one.
                accepted = {normalize(a) for a in (*q.answers, q.display_answer)}
                wrong = {normalize(o) for o in q.options} - accepted
                game.distractors[q.id] = game.distractors.get(q.id, frozenset()) | wrong
                game.options[q.id] = rng.sample(list(q.options), len(q.options))
        game.character = character
        self._game = game
        self._lang = lang
        self._tts = self.deps.new_tts()
        log.info("game_started", game_id=game_id, pack=pack.id, language=lang.code)
        await self._send(
            {
                "type": "game_start",
                "game_id": game_id,
                "pack": pack.summary(),
                "questions": n,
                "time_limit_s": self.s.answer_time_limit_s,
                "max_score": scoring.max_score(n),
                "character": character,
                "wizard": wizard,
                "story": (
                    {
                        "wizard": pack.story.wizard,
                        "wizard_sprite": pack.story.wizard_sprite,
                        "scene": pack.story.scene,
                        "chapters": len(pack.story.chapters),
                    }
                    if pack.story
                    else None
                ),
            }
        )
        if pack.story:
            await self._story("intro", pack.story.intro, mood="ask")
        else:
            await self._say(self.deps.lines.get(lang.code, "intro"), wait=True)

        for index, question in enumerate(game.questions):
            if self._gone.is_set():
                raise SessionEnded
            await self.deps.slots.heartbeat_game(game_id)
            if not await self._check_open():
                raise SessionEnded
            try:
                await self._play_question(game, index, question)
            except RoundSkipped:
                await self._send(
                    {
                        "type": "result",
                        "index": index,
                        "skipped": True,
                        "score": game.score,
                        "streak": game.streak,
                    }
                )
                await self._say(self.deps.lines.get(lang.code, "retry"), wait=True)
            if self._limit_reason:
                await self._fail("audio_limit", AUDIO_LIMIT_NOTE, CLOSE_LIMIT)
                raise SessionEnded

        if pack.story:
            band, ending = pack.story.ending(game.correct, n)
            mood = {"great": "cheer", "good": "happy", "try_again": "sad"}[band]
            await self._story("ending", ending, mood=mood, wait=False, extra={"band": band})
        else:
            await self._say(self.deps.lines.get(lang.code, "game_over"), wait=False)
        token = self.deps.tokens.issue_score(
            ScoreClaims(
                game_id=game_id,
                session_id=self.claims.session_id if self.claims else "",
                score=game.score,
                max_score=scoring.max_score(n),
                correct=game.correct,
                questions=n,
                language=lang.code,
                pack_id=pack.id,
                character=game.character,
            )
        )
        await self._send(
            {
                "type": "game_over",
                "game_id": game_id,
                "score": game.score,
                "correct": game.correct,
                "questions": n,
                "max_score": scoring.max_score(n),
                "score_token": token,
                "character": game.character,
            }
        )
        log.info(
            "game_finished", game_id=game_id, score=game.score, correct=game.correct, questions=n
        )
        await self._end_tts()
        self._game = None
        self._lang = None

    async def _play_question(self, game: GameState, index: int, q: Question) -> None:
        limit = self.s.answer_time_limit_s

        async def announce() -> _Speech | None:
            await self._send(
                {
                    "type": "question",
                    "index": index,
                    "total": len(game.questions),
                    "prompt": q.prompt,
                    "kind": q.kind,
                    "time_limit_s": limit,
                    "options": game.options.get(q.id),
                }
            )
            return await self._say(q.prompt, wait=False)

        transcript, answered_at, deadline = await self._listen_round(
            stt_lang=game.lang.stt_lang,
            index=index,
            announce=announce,
            echo_of=q.prompt,
            limit=limit,
        )
        await self._judge(game, index, q, transcript, answered_at, deadline, limit)

    async def _listen_round(
        self,
        *,
        stt_lang: str,
        index: int,
        announce: Callable[[], Awaitable[_Speech | None]],
        echo_of: str,
        limit: float,
        bias_words: list[str] | None = None,
    ) -> tuple[str | None, float, float]:
        """Open Prisma while ``announce`` speaks the prompt, then listen for one answer.

        Returns (transcript or None on timeout, answered_at, deadline). Raises RoundSkipped when
        the provider fails, so the caller can void the round instead of judging it."""
        stt = self.deps.new_stt(
            language=stt_lang, sample_rate=MIC_SAMPLE_RATE, bias_words=bias_words
        )
        open_task = asyncio.create_task(stt.open(), name="stt-open")
        # Everything after the STT open starts sits inside try/finally, so a disconnect at any
        # point can't leave a Prisma connection running.
        try:
            speech = await announce()
            try:
                await open_task
            except GnaniAuthError:
                log.error("stt_auth_failed")
                raise RoundSkipped from None
            except GnaniError as exc:
                log.warning("stt_open_failed", error=str(exc))
                raise RoundSkipped from None

            self._stt = stt
            self._vad.reset()
            self._listening = True
            await self._send(
                {"type": "listen", "index": index, "barge_in": self.s.barge_in_enabled}
            )
            return await self._await_answer(stt, echo_of, speech, limit)
        finally:
            self._listening = False
            self._stt = None
            if not open_task.done():
                open_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await open_task
            await stt.close()
            await self._charge_stt(stt)

    async def _await_answer(
        self, stt: SttStream, echo_of: str, speech: _Speech | None, limit: float
    ) -> tuple[str | None, float, float]:
        """Wait for a usable transcript or the deadline. Returns (text|None, at, deadline)."""
        grace = self.s.answer_grace_s
        deadline: float | None = None
        eos_sent = False
        while True:
            now = time.monotonic()
            if deadline is None:
                if speech is None:
                    deadline = now + limit + grace
                elif speech.task.done() or speech.interrupted_at is not None:
                    end = speech.interrupted_at or speech.playout.ends_at
                    deadline = max(end, now) + limit + grace
            wait = (deadline - now) if deadline is not None else 0.2
            if deadline is not None and wait <= 0:
                return None, now, deadline
            try:
                event = await asyncio.wait_for(stt.events.get(), timeout=max(wait, 0.01))
            except TimeoutError:
                if self._gone.is_set():
                    raise SessionEnded from None
                if self._limit_reason:
                    return None, time.monotonic(), deadline or time.monotonic()
                continue
            if event.kind == "processing" and not eos_sent:
                eos_sent = True
                await self._send({"type": "eos"})
            elif event.kind == "transcript":
                text = event.text.strip()
                if not text or looks_like_echo(text, echo_of):
                    eos_sent = False
                    await self._send({"type": "heard_nothing"})
                    continue
                at = time.monotonic()
                return text, at, deadline if deadline is not None else at + limit + grace
            elif event.kind in ("error", "closed"):
                raise RoundSkipped

    async def _judge(
        self,
        game: GameState,
        index: int,
        q: Question,
        transcript: str | None,
        answered_at: float,
        deadline: float,
        limit: float,
    ) -> None:
        lines, lang = self.deps.lines, game.lang.code
        timed_out = transcript is None
        result = (
            match_answer(
                transcript,
                q,
                game.distractors.get(q.id, frozenset()),
                language=game.lang.code,
            )
            if transcript
            else None
        )
        correct = bool(result and result.correct)
        game.answered += 1
        game.streak = game.streak + 1 if correct else 0
        remaining = max(0.0, deadline - self.s.answer_grace_s - answered_at)
        points = scoring.points_for(
            correct=correct, remaining_s=remaining, limit_s=limit, streak=game.streak
        )
        game.score += points
        game.correct += int(correct)
        await self._send(
            {
                "type": "result",
                "index": index,
                "correct": correct,
                "timed_out": timed_out,
                "heard": transcript or "",
                "answer": q.display_answer,
                "explanation": q.explanation,
                "points": points,
                "score": game.score,
                "streak": game.streak,
            }
        )
        story = game.pack.story
        if correct:
            chapter = story.chapter(game.correct) if story else None
            if story and chapter:
                await self._story("chapter", chapter, mood="happy", extra={"chapter": game.correct})
            else:
                await self._say(lines.get(lang, "correct"), wait=True)
        else:
            game.misses += 1
            if story:
                await self._story("setback", story.setback(game.misses), mood="sad")
            else:
                await self._say(lines.get(lang, "timeout" if timed_out else "wrong"), wait=True)
            await self._say(lines.get(lang, "answer_was", answer=q.display_answer), wait=True)

    async def _story(
        self,
        kind: str,
        text: str,
        *,
        mood: str,
        wait: bool = True,
        extra: dict[str, Any] | None = None,
    ) -> None:
        """Tell the client which beat of the wizard's quest this is, then speak it."""
        await self._send(
            {"type": "story", "kind": kind, "text": text, "mood": mood, **(extra or {})}
        )
        await self._say(text, wait=wait)

    # ------------------------------------------------------------------ speech ---------
    async def _say(self, text: str, *, wait: bool, caption: str | None = None) -> _Speech | None:
        """Speak ``text``; the client shows ``caption`` (default: the text itself)."""
        lang = self._lang
        if lang is None or self._gone.is_set():
            return None
        # A new line supersedes any line still streaming (the client does the same on
        # speak_start), so two utterances never interleave.
        previous = self._speech
        if previous is not None and not previous.task.done():
            previous.task.cancel()
            await asyncio.wait({previous.task})
        self._utterance = (self._utterance + 1) & 0xFFFF
        utt = self._utterance
        playout = Playout()
        # speak_start goes out before anything else this line causes (e.g. listen), so the
        # client always knows which utterance it is waiting on.
        await self._send(
            {
                "type": "speak_start",
                "utterance": utt,
                "caption": caption or text,
                "sample_rate": TTS_SAMPLE_RATE,
            }
        )
        task = asyncio.create_task(self._stream_speech(utt, text, lang, playout), name="speech")
        task.add_done_callback(_consume_exception)
        speech = _Speech(utt, time.monotonic(), task, playout)
        self._speech = speech
        if wait:
            await asyncio.wait({task})
            if task.cancelled():
                return speech
            if isinstance(task.exception(), SessionEnded):
                raise SessionEnded
            # Let the client finish playing before the next line starts.
            remaining = playout.ends_at - time.monotonic()
            if remaining > 0:
                await self._sleep_or_gone(remaining)
        return speech

    async def _stream_speech(
        self, utt: int, text: str, lang: LanguageRoute, playout: Playout
    ) -> float:
        """Send one line to the client; returns its audio duration in seconds."""
        s = self.s
        key = cache_key(
            model=s.gnani_tts_model,
            voice=lang.voice,
            language=lang.tts_lang,
            speed=lang.speed,
            text=text,
        )
        tts = self._tts
        # Voices come out of Timbre at different loudness; trim them to match on the way out.
        # The cache keeps the original level, so a trim change needs no re-render.
        gain = Gain(VOICE_GAIN_DB.get(lang.voice, 0.0))
        sent = 0
        interrupted = False
        try:
            pcm = await self.deps.cache.read(key)
            if pcm is not None:
                for i in range(0, len(pcm), AUDIO_CHUNK_BYTES):
                    chunk = pcm[i : i + AUDIO_CHUNK_BYTES]
                    await self._send_bytes(
                        audio_frame(utt, gain(chunk), i + len(chunk) >= len(pcm))
                    )
                    playout.sent(len(chunk))
                    sent += len(chunk)
            elif tts is not None and await self.deps.budget.is_open():
                await self.deps.budget.charge(self.deps.budget.tts_cost(len(text)), kind="tts")
                writer = self.deps.cache.writer(key)
                async with contextlib.aclosing(
                    tts.stream(text, voice=lang.voice, language=lang.tts_lang, speed=lang.speed)
                ) as chunks:
                    async for chunk in chunks:
                        writer.append(chunk)
                        await self._send_bytes(audio_frame(utt, gain(chunk), False))
                        playout.sent(len(chunk))
                        sent += len(chunk)
                # Only a whole clip is cached: a cut-off one would replay cut off for everyone.
                if tts.complete:
                    await writer.commit()
        except asyncio.CancelledError:
            interrupted = True
            raise
        except GnaniError as exc:
            # The caption is already on screen; the round goes on without audio.
            log.warning("tts_failed", error=str(exc))
        finally:
            with contextlib.suppress(Exception):
                await self._send(
                    {
                        "type": "speak_end",
                        "utterance": utt,
                        "duration_ms": int(sent / TTS_BYTES_PER_S * 1000),
                        "interrupted": interrupted,
                    }
                )
        return sent / TTS_BYTES_PER_S

    def _barge_in(self) -> None:
        speech = self._speech
        if speech is None or speech.interrupted_at is not None:
            return
        if speech.task.done() and time.monotonic() >= speech.playout.ends_at:
            return  # line already finished playing
        speech.interrupted_at = time.monotonic()

        async def stop() -> None:
            # barge_in goes out before the line's speak_end, so the client silences the right
            # utterance; frames sent in between are dropped by its gate.
            try:
                await self._send({"type": "barge_in", "utterance": speech.utterance})
            finally:
                if not speech.task.done():
                    speech.task.cancel()

        task = asyncio.create_task(stop())
        task.add_done_callback(lambda t: t.exception() if not t.cancelled() else None)

    # ------------------------------------------------------------------ inbound --------
    async def _receive_loop(self) -> None:
        try:
            while True:
                message = await self.ws.receive()
                if message["type"] == "websocket.disconnect":
                    break
                try:
                    if message.get("bytes") is not None:
                        await self._on_audio(message["bytes"])
                    elif message.get("text") is not None:
                        await self._on_control(message["text"])
                except (SessionEnded, WebSocketDisconnect):
                    raise
                except Exception as exc:
                    # One bad message (or a Redis blip) must not kill the receiver and with it
                    # the player's game.
                    log.error("ws_message_failed", error=type(exc).__name__)
                    await self._strike()
        except (WebSocketDisconnect, RuntimeError):
            pass
        except SessionEnded:
            pass
        finally:
            self._gone.set()

    async def _on_control(self, raw: str) -> None:
        if self._closing:
            return
        now = time.monotonic()
        start, count = self._msg_window
        if now - start >= 1.0:
            self._msg_window = (now, 1)
        else:
            self._msg_window = (start, count + 1)
            if count + 1 > self.s.max_control_msgs_per_s:
                await self._strike()
                return
        if len(raw) > self.s.max_control_msg_bytes:
            await self._strike()
            return
        try:
            msg = json.loads(raw)
            kind = msg["type"]
        except (ValueError, KeyError, TypeError):
            await self._strike()
            return
        if kind == "ping":
            await self._send({"type": "pong", "t": msg.get("t")})
        elif kind == "start":
            if self._lang is None and self._commands.empty():
                self._commands.put_nowait(
                    {
                        "type": "start",
                        "pack_id": msg.get("pack_id"),
                        "character": msg.get("character"),
                        "wizard": msg.get("wizard"),
                    }
                )
        elif kind == "start_adventure":
            if self._lang is None and self._commands.empty():
                self._commands.put_nowait(
                    {
                        "type": "start_adventure",
                        "adventure": msg.get("adventure"),
                        "language": msg.get("language"),
                        "character": msg.get("character"),
                        "wizard": msg.get("wizard"),
                    }
                )
        elif kind == "quit":
            self._gone.set()
        elif kind == "playback_done":
            pass  # accepted for client metrics; timing is server-side
        else:
            await self._strike()

    async def _on_audio(self, data: bytes) -> None:
        if self._closing:
            return
        if not data or len(data) > self.s.max_client_frame_bytes or len(data) % 2:
            await self._strike()
            return
        if not self._listening or self._stt is None:
            return  # mic audio outside a listening window is ignored (and never billed)
        seconds = len(data) / MIC_BYTES_PER_S
        self._audio_pending += seconds
        if self._audio_pending >= AUDIO_FLUSH_S:
            if not await self._flush_audio_usage():
                self._listening = False
                return
        # Re-read after the await: the round may have ended while Redis was answering.
        stt = self._stt
        if not self._listening or stt is None:
            return
        if self.s.barge_in_enabled and self._vad.update(data):
            self._barge_in()
        stt.feed(data)

    async def _flush_audio_usage(self, *, enforce: bool = True) -> bool:
        """Move pending mic seconds into the Redis counters. Session and IP caps both live in
        Redis, so reconnecting with the same token doesn't reset them."""
        pending, self._audio_pending = self._audio_pending, 0.0
        if pending <= 0 or self.claims is None:
            return True
        session_cap = self.s.max_audio_s_per_session if enforce else float("inf")
        ip_cap = self.s.max_audio_s_per_ip_day if enforce else float("inf")
        ok, _ = await self.deps.limiter.consume_float(
            "sessaudio", self.claims.session_id, pending, session_cap, self.s.session_ttl_s + 60
        )
        if not ok:
            self._limit_reason = "session_audio"
            return False
        ok, _ = await self.deps.limiter.consume_float(
            "ipaudio",
            f"{self.ip_hash}:{day_key()}",
            pending,
            ip_cap,
            seconds_until_ist_midnight() + 3600,
        )
        if not ok:
            self._limit_reason = "ip_audio"
            return False
        return True

    async def _strike(self) -> None:
        self._strikes += 1
        if self._strikes > MAX_PROTOCOL_STRIKES and not self._closing:
            # Close from another task: the receive loop must keep draining inbound frames,
            # or the close handshake can't complete behind a full receive queue.
            self._closing = True
            self._listening = False
            log.warning("ws_protocol_abuse", ip_hash=self.ip_hash)
            self._fail_task = asyncio.create_task(
                self._fail("protocol", "Connection closed.", CLOSE_PROTOCOL)
            )
            self._fail_task.add_done_callback(_consume_exception)
            self._gone.set()

    async def _next_command(self, timeout: float) -> dict[str, Any] | None:
        get = asyncio.create_task(self._commands.get())
        gone = asyncio.create_task(self._gone.wait())
        try:
            done, _ = await asyncio.wait(
                {get, gone}, timeout=timeout, return_when=asyncio.FIRST_COMPLETED
            )
            if get in done:
                return get.result()
            if gone in done:
                raise SessionEnded
            return None
        finally:
            for t in (get, gone):
                if not t.done():
                    t.cancel()

    async def _sleep_or_gone(self, seconds: float) -> None:
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._gone.wait(), timeout=seconds)
        if self._gone.is_set():
            raise SessionEnded

    # ------------------------------------------------------------------ outbound -------
    async def _send(self, payload: dict[str, Any]) -> None:
        if self.ws.client_state != WebSocketState.CONNECTED:
            raise SessionEnded
        async with self._send_lock:
            try:
                await self.ws.send_text(json.dumps(payload, ensure_ascii=False))
            except (WebSocketDisconnect, RuntimeError) as exc:
                self._gone.set()
                raise SessionEnded from exc

    async def _send_bytes(self, data: bytes) -> None:
        if self.ws.client_state != WebSocketState.CONNECTED:
            raise SessionEnded
        async with self._send_lock:
            try:
                await self.ws.send_bytes(data)
            except (WebSocketDisconnect, RuntimeError) as exc:
                self._gone.set()
                raise SessionEnded from exc

    async def _send_error(self, code: str, message: str) -> None:
        await self._send({"type": "error", "code": code, "message": message, "fatal": False})

    async def _fail(self, code: str, message: str, close_code: int) -> None:
        with contextlib.suppress(Exception):
            if self.ws.client_state == WebSocketState.CONNECTED:
                async with self._send_lock:
                    await self.ws.send_text(
                        json.dumps(
                            {"type": "error", "code": code, "message": message, "fatal": True},
                            ensure_ascii=False,
                        )
                    )
                    await self.ws.close(code=close_code)

    # ------------------------------------------------------------------ housekeeping ---
    async def _charge_stt(self, stt: SttStream) -> None:
        seconds = stt.audio_seconds_sent
        if seconds > 0:
            await self.deps.budget.charge(self.deps.budget.stt_cost(seconds), kind="stt")

    async def _heartbeat_loop(self) -> None:
        assert self.claims is not None
        while True:
            await asyncio.sleep(20)
            await self.deps.slots.refresh_session(self.claims.session_id, self.owner)
            if time.time() >= self.claims.expires_at:
                await self._fail("unauthorized", "Session expired. Please start again.", CLOSE_AUTH)
                self._gone.set()
                return

    async def _cleanup(self) -> None:
        self._gone.set()
        self._listening = False
        self._closing = True
        if self._fail_task is not None:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(asyncio.shield(self._fail_task), timeout=5)
        # Close while the receiver is still draining, so the close handshake can finish.
        if self.ws.client_state == WebSocketState.CONNECTED:
            with contextlib.suppress(Exception):
                async with self._send_lock:
                    await asyncio.wait_for(self.ws.close(code=1000), timeout=5)
        speech = self._speech
        tasks = [t for t in (self._receiver, self._heartbeat) if t is not None]
        if speech is not None and not speech.task.done():
            tasks.append(speech.task)
        for t in tasks:
            t.cancel()
        for t in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t
        if self._stt is not None:
            await self._stt.close()
            await self._charge_stt(self._stt)
        if self._tts is not None:
            await self._tts.close()
        with contextlib.suppress(Exception):
            await self._flush_audio_usage(enforce=False)
        if self.claims is not None:
            with contextlib.suppress(Exception):
                await self.deps.slots.unlock_session(self.claims.session_id, self.owner)


def _consume_exception(task: asyncio.Task[Any]) -> None:
    if not task.cancelled():
        exc = task.exception()
        if exc is not None and not isinstance(exc, SessionEnded):
            log.error("speech_task_failed", error=type(exc).__name__)
