"""One adventure run on the game socket (PROTOCOL §10).

The runner walks the story graph from ``app.game.adventures``. At each node it:
- shows the scene;
- has the wizard speak the node's lines;
- then waits for whatever the node asks for: a spoken choice, a spoken puzzle answer, or nothing
  (the story moves on by itself).

Flags and the meter carry the player's earlier answers forward. The server alone decides:
- which choice was heard;
- whether a puzzle answer is right;
- the score;
- how long the run took.
So the score token it signs at the end can't be forged from the browser.

"auto" runs the wizard's prologue first. Its answers pick the adventure, and the run then
continues straight into that adventure on the same socket.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from app.game import scoring
from app.game.adventures import (
    Adventure,
    Choice,
    Effects,
    Node,
    Puzzle,
    apply,
    available,
    match_choice,
    resolve,
    spoken,
)
from app.game.languages import LanguageRoute
from app.game.matching import match_answer, normalize
from app.game.packs import Question
from app.logging import get_logger
from app.security.tokens import ScoreClaims

if TYPE_CHECKING:
    from app.ws.play import PlaySession, _Speech

log = get_logger(__name__)

CHOICE_ATTEMPTS = 3  # tries to hear a choice before the wizard picks one
MAX_SKIPS = 2  # provider failures retried per choice or riddle before giving up


class LimitReached(Exception):
    """The player's audio allowance ran out mid-run; the session ends without a score."""


MAX_STEPS = 80  # defensive cap on nodes visited in one run (validated graphs stay far below)
ENDING_BONUS = {"gold": 500, "silver": 300, "bronze": 100}
MOOD_FOR_RANK = {"gold": "cheer", "silver": "happy", "bronze": "sad"}


@dataclass
class RunState:
    game_id: str
    adventure: Adventure
    language: str
    wizard: str
    character: str
    started: float = field(default_factory=time.monotonic)
    flags: frozenset[str] = frozenset()
    meter: int = 0
    scene: str = "portals"
    step: int = 0
    path: list[str] = field(default_factory=list)
    score: int = 0
    puzzles: int = 0
    solved: int = 0
    streak: int = 0
    choices_made: int = 0


class AdventureRunner:
    def __init__(self, session: PlaySession, lang: LanguageRoute) -> None:
        self.session = session
        self.deps = session.deps
        self.s = session.s
        self.lang = lang
        self.code = lang.code
        self.rng = secrets.SystemRandom()

    # ------------------------------------------------------------------ flow ----------
    async def run(self, game_id: str, adventure: Adventure, wizard: str, character: str) -> None:
        sess = self.session
        st = RunState(game_id, adventure, self.code, wizard, character)
        await self._begin(st, adventure, routed=False)
        if adventure.genre != "prologue":
            await self._wizard_line(st, "greet", mood="happy")
        target = adventure.start
        while True:
            if target.startswith("adventure:"):
                nxt = self.deps.adventures.get(target.split(":", 1)[1])
                if nxt is None:  # validated at load; a missing file is a deploy error
                    raise RuntimeError(f"prologue points at missing adventure {target}")
                await self._begin(st, nxt, routed=True)
                target = nxt.start
                continue
            if target.startswith("end:"):
                await self._finish(st, target[4:])
                return
            self._check_limit()
            st.step += 1
            if st.step > MAX_STEPS:
                raise RuntimeError("adventure exceeded the step cap")
            await self.deps.slots.heartbeat_game(game_id)
            if not await sess._check_open():
                from app.ws.play import SessionEnded

                raise SessionEnded
            target = await self._node(st, target)

    async def _begin(self, st: RunState, adventure: Adventure, *, routed: bool) -> None:
        st.adventure = adventure
        st.flags = frozenset()
        st.meter = adventure.meter.start if adventure.meter else 0
        st.scene = adventure.cover
        if routed:
            st.path.append(f"adventure:{adventure.id}")
        await self.session._send(
            {
                "type": "adventure_start",
                "game_id": st.game_id,
                "adventure": adventure.summary(self.code)
                if adventure.genre != "prologue"
                else {
                    "id": adventure.id,
                    "genre": "prologue",
                    "title": adventure.title[self.code],
                    "tagline": adventure.tagline[self.code],
                    "cover": adventure.cover,
                    "meter": None,
                    "endings": [],
                    "scenes": sorted(adventure.scenes()),
                },
                "routed": routed,
                "character": st.character,
                "wizard": st.wizard,
                "meter": st.meter if adventure.meter else None,
                "time_limit_s": self.s.answer_time_limit_s,
                "choice_time_limit_s": self.s.choice_time_limit_s,
            }
        )

    async def _node(self, st: RunState, node_id: str) -> str:
        adv = st.adventure
        node = adv.node(node_id)
        st.path.append(node_id)
        if node.scene:
            st.scene = node.scene
        before = st.meter
        st.flags, st.meter = apply(node.enter, st.flags, st.meter, self._top(st))
        await self.session._send(
            {
                "type": "node",
                "id": node_id,
                "scene": st.scene,
                "mood": node.mood,
                "step": st.step,
                "kind": "choice" if node.choices else "puzzle" if node.puzzle else "story",
                **self._state(st, node.enter, before),
            }
        )
        if self._fell_to_zero(st, before):
            await self._say_lines(st, node.say)
            return adv.meter.on_zero  # type: ignore[union-attr,return-value]
        if node.go is not None:
            await self._say_lines(st, node.say)
            return resolve(node.go, st.flags, st.meter)
        if node.puzzle is not None:
            await self._say_lines(st, node.say)
            return await self._puzzle(st, node.puzzle)
        return await self._choose(st, node)

    # ------------------------------------------------------------------ choices -------
    async def _choose(self, st: RunState, node: Node) -> str:
        sess = self.session
        opts = available(node, st.flags, st.meter)
        labels = [c.label[self.code] for c in opts]
        cards = [(c.label[self.code], c.keywords[self.code]) for c in opts]
        bias = _bias_words(opts, self.code)
        await self._say_lines(st, node.say[:-1])
        last = node.say[-1]
        picked: int | None = None
        heard = ""
        from app.ws.play import RoundSkipped

        again = self.deps.wizards.get(self.code, st.wizard, "choose_again")
        attempt = 0
        skips = 0
        while attempt < CHOICE_ATTEMPTS:
            attempt += 1
            first = attempt == 1 and skips == 0

            async def announce(first: bool = first) -> _Speech | None:
                if first:
                    await sess._send(
                        {
                            "type": "choices",
                            "choices": [{"label": label} for label in labels],
                            "attempt": 1,
                            "time_limit_s": self.s.choice_time_limit_s,
                        }
                    )
                    return await self._speak(last)
                return await sess._say(again.tts, wait=False, caption=again.text)

            try:
                transcript, _, _ = await sess._listen_round(
                    stt_lang=self.lang.stt_lang,
                    index=st.step,
                    announce=announce,
                    # Echo guard: compare against the line actually being spoken.
                    echo_of=spoken(last, self.code) if first else again.tts,
                    limit=self.s.choice_time_limit_s,
                    bias_words=bias,
                )
            except RoundSkipped:
                # A provider failure is not the player's fault: it doesn't use up a try
                # (but gives up after a few, so an outage can't stall the run).
                transcript = None
                skips += 1
                if skips <= MAX_SKIPS:
                    attempt -= 1
            self._check_limit()
            heard = transcript or ""
            picked = match_choice(heard, cards) if heard else None
            if picked is not None:
                break
            await sess._send(
                {
                    "type": "unclear",
                    "heard": heard,
                    "attempts_left": CHOICE_ATTEMPTS - attempt,
                }
            )
        auto = picked is None
        if auto:
            picked = 0
            line = self.deps.wizards.get(self.code, st.wizard, "chose_for_you")
            await sess._say(line.tts, wait=True, caption=line.text)
        choice = opts[picked]
        st.choices_made += 1
        st.path.append(f"#{picked}")
        await sess._send({"type": "chosen", "index": picked, "heard": heard, "auto": auto})
        return await self._outcome(st, choice.effects, choice.say, choice.go)

    # ------------------------------------------------------------------ puzzles -------
    async def _puzzle(self, st: RunState, p: Puzzle) -> str:
        sess = self.session
        code = self.code
        limit = self.s.answer_time_limit_s
        order = list(range(3))
        self.rng.shuffle(order)
        shown = [p.options[code][i] for i in order]
        from app.ws.play import RoundSkipped

        async def announce() -> _Speech | None:
            await sess._send(
                {
                    "type": "puzzle",
                    "prompt": p.prompt[code],
                    "options": shown,
                    "kind": p.kind,
                    "time_limit_s": limit,
                }
            )
            return await self._speak(p.prompt)

        skipped = False
        transcript: str | None = None
        answered_at = deadline = time.monotonic()
        for tries in range(MAX_SKIPS + 1):
            try:
                transcript, answered_at, deadline = await sess._listen_round(
                    stt_lang=self.lang.stt_lang,
                    index=st.step,
                    announce=announce,
                    echo_of=spoken(p.prompt, code),
                    limit=limit,
                    bias_words=_puzzle_bias(shown),
                )
                skipped = False
                break
            except RoundSkipped:
                # Ask again; if the provider keeps failing, the riddle is voided below.
                skipped = True
                transcript = None
                answered_at = deadline = time.monotonic()
                log.warning("adventure_riddle_skipped", tries=tries + 1)
        self._check_limit()
        correct = bool(transcript) and puzzle_correct(p, code, transcript or "")
        st.puzzles += int(not skipped)
        if not skipped:
            st.streak = st.streak + 1 if correct else 0
        remaining = max(0.0, deadline - self.s.answer_grace_s - answered_at)
        points = scoring.points_for(
            correct=correct, remaining_s=remaining, limit_s=limit, streak=st.streak
        )
        st.score += points
        st.solved += int(correct)
        await sess._send(
            {
                "type": "puzzle_result",
                "correct": correct,
                "timed_out": transcript is None and not skipped,
                "skipped": skipped,
                "heard": transcript or "",
                "answer": p.display_answer(code),
                "points": points,
                "score": st.score,
                "streak": st.streak,
            }
        )
        if not skipped:
            await self._wizard_line(st, "puzzle_right" if correct else "puzzle_wrong")
        # A riddle voided by a provider outage must not push the player down the worse path.
        outcome = p.pass_ if correct or skipped else p.fail
        return await self._outcome(st, outcome.effects, outcome.say, outcome.go)

    # ------------------------------------------------------------------ shared --------
    async def _outcome(
        self, st: RunState, effects: Effects | None, say: list[dict[str, str]], route: Any
    ) -> str:
        before = st.meter
        st.flags, st.meter = apply(effects, st.flags, st.meter, self._top(st))
        if effects is not None:
            await self.session._send({"type": "state", **self._state(st, effects, before)})
        await self._say_lines(st, say)
        if self._fell_to_zero(st, before):
            return st.adventure.meter.on_zero  # type: ignore[union-attr,return-value]
        return resolve(route, st.flags, st.meter)

    async def _finish(self, st: RunState, ending_id: str) -> None:
        sess = self.session
        adv = st.adventure
        ending = adv.endings[ending_id]
        duration_ms = int((time.monotonic() - st.started) * 1000)
        bonus = ENDING_BONUS[ending.rank]
        st.score += bonus
        st.path.append(f"end:{ending_id}")
        await sess._send(
            {
                "type": "ending",
                "id": ending_id,
                "title": ending.title[self.code],
                "rank": ending.rank,
                "scene": ending.scene or st.scene,
                "mood": ending.mood,
                "bonus": bonus,
                "score": st.score,
                "endings": [{"id": k, "rank": e.rank} for k, e in adv.endings.items()],
            }
        )
        await self._say_lines(st, ending.say)
        good = ending.rank != "bronze"
        await self._wizard_line(
            st, "ending_good" if good else "ending_bad", mood=MOOD_FOR_RANK[ending.rank], wait=False
        )
        max_score = adventure_max_score(adv)
        token = self.deps.tokens.issue_score(
            ScoreClaims(
                game_id=st.game_id,
                session_id=sess.claims.session_id if sess.claims else "",
                score=min(st.score, max_score),
                max_score=max_score,
                correct=st.solved,
                questions=st.puzzles,
                language=self.code,
                pack_id=adv.id,
                character=st.character,
                mode="adventure",
                duration_ms=duration_ms,
                ending_id=ending_id,
                ending_rank=ending.rank,
                wizard=st.wizard,
            )
        )
        await sess._send(
            {
                "type": "game_over",
                "game_id": st.game_id,
                "mode": "adventure",
                "score": min(st.score, max_score),
                "correct": st.solved,
                "questions": st.puzzles,
                "max_score": max_score,
                "score_token": token,
                "character": st.character,
                "wizard": st.wizard,
                "adventure": adv.id,
                "ending": {"id": ending_id, "title": ending.title[self.code], "rank": ending.rank},
                "duration_ms": duration_ms,
                "choices": st.choices_made,
            }
        )
        log.info(
            "adventure_finished",
            game_id=st.game_id,
            adventure=adv.id,
            ending=ending_id,
            score=st.score,
            duration_ms=duration_ms,
            steps=st.step,
        )

    async def _say_lines(self, st: RunState, lines: list[dict[str, str]]) -> None:
        for line in lines:
            await self._speak(line, wait=True)

    async def _speak(self, line: dict[str, str], *, wait: bool = False) -> _Speech | None:
        return await self.session._say(spoken(line, self.code), wait=wait, caption=line[self.code])

    async def _wizard_line(
        self, st: RunState, key: str, *, mood: str | None = None, wait: bool = True
    ) -> None:
        line = self.deps.wizards.get(self.code, st.wizard, key)
        await self.session._send({"type": "wizard", "key": key, "mood": mood})
        await self.session._say(line.tts, wait=wait, caption=line.text)

    def _check_limit(self) -> None:
        if self.session._limit_reason:
            raise LimitReached

    def _top(self, st: RunState) -> int:
        return st.adventure.meter.max if st.adventure.meter else 0

    def _fell_to_zero(self, st: RunState, before: int) -> bool:
        m = st.adventure.meter
        return bool(m and m.on_zero and st.meter == 0 and st.meter < before)

    def _state(self, st: RunState, effects: Effects | None, before: int) -> dict[str, Any]:
        adv = st.adventure
        items = [
            {"id": k, "label": adv.items[k].label[self.code]}
            for k in sorted(st.flags)
            if k in adv.items
        ]
        gained = [g for g in (effects.gain if effects else []) if g in adv.items]
        return {
            "meter": st.meter if adv.meter else None,
            "meter_delta": st.meter - before,
            "items": items,
            "gained": gained,
        }


# ---------------------------------------------------------------------- helpers -------
def puzzle_correct(p: Puzzle, lang: str, transcript: str) -> bool:
    """Judge a spoken puzzle answer with the shared answer matcher.

    Saying one of the wrong on-screen options (alone or alongside the right one) is wrong.
    Number puzzles accept the number in digits or words; word aliases are tried as text.
    """
    wrong = frozenset(normalize(o) for o in p.wrong_options(lang))
    answer = p.display_answer(lang)
    accepted = [a for a in p.accepted(lang) if normalize(a)]
    questions: list[Question] = []
    if p.kind == "number":
        questions.append(
            Question(
                id="p",
                prompt=p.prompt[lang],
                answers=[answer],
                display_answer=answer,
                kind="number",
            )
        )
        words = [a for a in accepted if normalize(a) != normalize(answer)]
        if words:
            questions.append(
                Question(id="p", prompt=p.prompt[lang], answers=words[:10], display_answer=answer)
            )
    else:
        questions.append(
            Question(id="p", prompt=p.prompt[lang], answers=accepted[:10], display_answer=answer)
        )
    return any(match_answer(transcript, q, wrong, language=lang).correct for q in questions)


def adventure_max_score(adv: Adventure) -> int:
    """An upper bound for the score token: every puzzle node solved at full speed in a row,
    plus a gold ending."""
    puzzles = sum(1 for n in adv.nodes.values() if n.puzzle is not None)
    return scoring.max_score(puzzles) + ENDING_BONUS["gold"]


def _bias_words(opts: list[Choice], lang: str) -> list[str] | None:
    """Prisma keyword boosting: the Latin-script words on the choice cards.

    HTTP header values must stay ASCII, so Indic-script words are left to the matcher (it
    compares by sound across scripts)."""
    words: list[str] = []
    for c in opts:
        for phrase in (c.label[lang], *c.keywords[lang]):
            for w in normalize(phrase).split():
                if len(w) > 2 and w.isascii() and w.isalpha() and w not in words:
                    words.append(w)
    return words[:30] or None


def _puzzle_bias(options: list[str]) -> list[str] | None:
    words = [
        w
        for o in options
        for w in normalize(o).split()
        if len(w) > 2 and w.isascii() and w.isalpha()
    ]
    return words[:10] or None
