"""End-to-end: browser client ↔ real app (uvicorn) ↔ protocol-faithful Gnani mocks,
with real Redis and Postgres."""

from __future__ import annotations

import asyncio
import itertools
import json
import struct
import time

import httpx
import pytest
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus

from app.game.packs import parse_pack
from tests.conftest import FIXTURES, ORIGIN
from tests.mock_gnani import silence, tone

PACK = parse_pack((FIXTURES / "packs" / "hi-test-01.json").read_bytes())
ANSWERS = {q.prompt: q for q in PACK.questions}
ANSWERS_STORY = {
    q.prompt: q
    for q in parse_pack((FIXTURES / "packs" / "hi-story-01.json").read_bytes()).questions
}
MIC_CHUNK = 640  # 20 ms at 16 kHz — a typical AudioWorklet buffer


async def get_session(base: str) -> str:
    async with httpx.AsyncClient(base_url=base) as c:
        r = await c.post(
            "/api/session", json={"turnstile_token": "pass"}, headers={"Origin": ORIGIN}
        )
        assert r.status_code == 200, r.text
        return r.json()["token"]


async def stream_mic(ws, pcm: bytes) -> None:
    """Send audio at real-time cadence, like a browser AudioWorklet."""
    start = time.monotonic()
    for i in range(0, len(pcm), MIC_CHUNK):
        await ws.send(pcm[i : i + MIC_CHUNK])
        due = start + (i + MIC_CHUNK) / 32000
        await asyncio.sleep(max(0.0, due - time.monotonic()))


class Client:
    def __init__(self, ws) -> None:
        self.ws = ws
        self.audio: dict[int, int] = {}
        self.log: list[dict] = []

    async def next(self, *types: str, timeout: float = 10.0) -> dict:
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AssertionError(f"timed out waiting for {types}; saw {self.log[-5:]}")
            msg = await asyncio.wait_for(self.ws.recv(), timeout=remaining)
            if isinstance(msg, bytes):
                magic, utt, _flags = struct.unpack(">BHB", msg[:4])
                assert magic == 0x41
                self.audio[utt] = self.audio.get(utt, 0) + len(msg) - 4
                continue
            data = json.loads(msg)
            self.log.append(data)
            if data["type"] in types:
                return data


async def open_game(server, token: str) -> Client:
    ws = await connect(server.ws, origin=ORIGIN, subprotocols=["maata.v1"])
    await ws.send(json.dumps({"type": "auth", "token": token}))
    c = Client(ws)
    ready = await c.next("ready")
    assert ready["protocol"] == "maata.v1"
    return c


async def answer(c: Client, gnani, text: str) -> None:
    gnani.state.transcripts.append(text)
    await stream_mic(c.ws, silence(0.1) + tone(0.4) + silence(0.5))


async def test_full_game_correct_and_wrong_answers_then_leaderboard(live, clean_gnani):
    with live() as server:
        token = await get_session(server.http)
        c = await open_game(server, token)
        await c.ws.send(json.dumps({"type": "start", "pack_id": "hi-test-01"}))
        start = await c.next("game_start")
        assert start["questions"] == 2

        # Q1: answer correctly, with filler words around the answer.
        q = await c.next("question")
        await c.next("listen")
        qq = ANSWERS[q["prompt"]]
        await answer(c, clean_gnani, f"मेरा जवाब {qq.answers[0]} है")
        r1 = await c.next("result")
        assert r1["correct"] is True and r1["points"] >= 100

        # Q2: answer wrongly.
        q = await c.next("question")
        await c.next("listen")
        await answer(c, clean_gnani, "बिल्कुल पता नहीं")
        r2 = await c.next("result")
        assert r2["correct"] is False and r2["points"] == 0
        assert r2["answer"] == ANSWERS[q["prompt"]].display_answer

        over = await c.next("game_over")
        assert over["score"] == r1["points"]
        assert over["correct"] == 1
        await c.ws.close()

        # Every frame Prisma received was exactly 1,024 bytes; audio was actually spoken.
        assert clean_gnani.state.stt_violations == []
        assert clean_gnani.state.stt_frame_times
        assert any(n > 0 for n in c.audio.values())
        hdr = clean_gnani.state.stt_headers[0]
        assert hdr["lang_code"] == "hi-IN" and hdr["x-sample-rate"] == "16000"
        assert hdr["x-format"] == "transcribe"

        async with httpx.AsyncClient(base_url=server.http) as h:
            post = await h.post(
                "/api/scores",
                headers={"Origin": ORIGIN},
                json={"score_token": over["score_token"], "nickname": "Vector"},
            )
            assert post.status_code == 200, post.text
            replay = await h.post(
                "/api/scores",
                headers={"Origin": ORIGIN},
                json={"score_token": over["score_token"], "nickname": "Again"},
            )
            assert replay.status_code == 409
            board = (
                await h.get(
                    "/api/leaderboard",
                    params={"language": "hi-IN", "period": "today", "mode": "quiz"},
                )
            ).json()
            assert board["entries"][0]["nickname"] == "Vector"
            assert board["entries"][0]["score"] == over["score"]


async def test_timeout_when_player_stays_silent(live, clean_gnani):
    with live(questions_per_game=1, answer_time_limit_s=1.5) as server:
        c = await open_game(server, await get_session(server.http))
        await c.ws.send(json.dumps({"type": "start", "pack_id": "hi-test-01"}))
        await c.next("listen")
        await stream_mic(c.ws, silence(2.5))
        r = await c.next("result", timeout=8)
        assert r["timed_out"] is True and r["correct"] is False
        await c.next("game_over")


async def test_cached_lines_are_not_resynthesised(live, clean_gnani):
    with live(questions_per_game=1, answer_time_limit_s=1.0) as server:
        for _ in range(2):
            c = await open_game(server, await get_session(server.http))
            await c.ws.send(json.dumps({"type": "start", "pack_id": "hi-test-01"}))
            await c.next("game_over", timeout=15)
            await c.ws.close()
        texts = [r["text"] for r in clean_gnani.state.tts_requests]
        # Intro was spoken in both games but synthesised once.
        assert len(texts) == len(set(texts))


async def test_barge_in_stops_question_audio(live, clean_gnani):
    clean_gnani.state.tts_audio_s = 3.0
    clean_gnani.state.tts_chunk_delay_s = 0.1  # live TTS slower than realtime-ish
    with live(questions_per_game=1) as server:
        c = await open_game(server, await get_session(server.http))
        await c.ws.send(json.dumps({"type": "start", "pack_id": "hi-test-01"}))
        q = await c.next("question", timeout=20)
        await c.next("listen")
        clean_gnani.state.transcripts.append(ANSWERS[q["prompt"]].answers[0])
        speak = asyncio.create_task(stream_mic(c.ws, tone(0.5) + silence(0.5)))
        barge = await c.next("barge_in", timeout=5)
        assert isinstance(barge["utterance"], int)
        end = await c.next("speak_end")
        assert end["utterance"] == barge["utterance"] and end["interrupted"] is True
        await speak
        r = await c.next("result")
        assert r["correct"] is True


async def test_bad_session_token_closes_socket(live):
    with live() as server:
        ws = await connect(server.ws, origin=ORIGIN, subprotocols=["maata.v1"])
        await ws.send(json.dumps({"type": "auth", "token": "not-a-token"}))
        err = json.loads(await ws.recv())
        assert err["code"] == "unauthorized" and err["fatal"] is True
        with pytest.raises(ConnectionClosed) as info:
            await ws.recv()
        assert info.value.rcvd.code == 4401


async def test_foreign_origin_is_refused(live):
    with live() as server:
        with pytest.raises((InvalidStatus, ConnectionClosed)):
            ws = await connect(server.ws, origin="https://evil.example", subprotocols=["maata.v1"])
            await ws.recv()


async def test_auth_timeout(live):
    with live(auth_timeout_s=0.5) as server:
        ws = await connect(server.ws, origin=ORIGIN, subprotocols=["maata.v1"])
        err = json.loads(await asyncio.wait_for(ws.recv(), 3))
        assert err["code"] == "unauthorized"


async def test_second_socket_for_same_session_rejected(live):
    with live() as server:
        token = await get_session(server.http)
        c1 = await open_game(server, token)
        ws2 = await connect(server.ws, origin=ORIGIN, subprotocols=["maata.v1"])
        await ws2.send(json.dumps({"type": "auth", "token": token}))
        err = json.loads(await ws2.recv())
        assert err["code"] == "already_connected"
        await c1.ws.close()


async def test_kill_switch_closes_lobby(live, redis_sync):
    with live() as server:
        c = await open_game(server, await get_session(server.http))
        redis_sync.set("maata:killswitch", "1")
        await c.ws.send(json.dumps({"type": "start", "pack_id": "hi-test-01"}))
        err = await c.next("error")
        assert err["code"] == "closed_for_today" and err["fatal"] is True
        async with httpx.AsyncClient(base_url=server.http) as h:
            st = (await h.get("/api/status")).json()
            assert st["open"] is False and st["reason"] == "maintenance"
            s = await h.post(
                "/api/session", json={"turnstile_token": "pass"}, headers={"Origin": ORIGIN}
            )
            assert s.status_code == 503


async def test_stt_outage_skips_round_without_penalty(live, clean_gnani):
    clean_gnani.state.fail_stt_handshake_status = 503
    with live(questions_per_game=1) as server:
        c = await open_game(server, await get_session(server.http))
        await c.ws.send(json.dumps({"type": "start", "pack_id": "hi-test-01"}))
        r = await c.next("result", timeout=20)
        assert r["skipped"] is True
        over = await c.next("game_over", timeout=20)
        assert over["score"] == 0


async def test_session_audio_cap_ends_game(live, clean_gnani):
    with live(questions_per_game=1, max_audio_s_per_session=0.5, answer_time_limit_s=3.0) as server:
        c = await open_game(server, await get_session(server.http))
        await c.ws.send(json.dumps({"type": "start", "pack_id": "hi-test-01"}))
        await c.next("listen")
        await stream_mic(c.ws, silence(1.5))
        err = await c.next("error", timeout=10)
        assert err["code"] == "audio_limit"


async def test_oversized_and_malformed_frames_get_disconnected(live):
    with live() as server:
        c = await open_game(server, await get_session(server.http))
        with pytest.raises(ConnectionClosed):
            for _ in range(30):
                await c.ws.send(b"\x00" * 9000)
                await c.ws.send("{not json")
            await c.next("never", timeout=5)


async def test_session_audio_cap_survives_reconnect(live, clean_gnani):
    with live(questions_per_game=1, max_audio_s_per_session=1.2, answer_time_limit_s=1.0) as server:
        token = await get_session(server.http)
        c = await open_game(server, token)
        await c.ws.send(json.dumps({"type": "start", "pack_id": "hi-test-01"}))
        await c.next("listen")
        await stream_mic(c.ws, silence(1.0))
        await c.next("game_over", timeout=10)
        await c.ws.close()
        await asyncio.sleep(0.3)
        c2 = await open_game(server, token)  # same token, fresh socket
        await c2.ws.send(json.dumps({"type": "start", "pack_id": "hi-test-01"}))
        await c2.next("listen")
        await stream_mic(c2.ws, silence(1.0))
        err = await c2.next("error", timeout=10)
        assert err["code"] == "audio_limit"


async def test_wizard_story_and_character_reach_leaderboard(live, clean_gnani):
    with live(questions_per_game=2) as server:
        c = await open_game(server, await get_session(server.http))
        await c.ws.send(
            json.dumps(
                {"type": "start", "pack_id": "hi-story-01", "character": "meera", "wizard": "owl"}
            )
        )
        start = await c.next("game_start")
        assert start["character"] == "meera"
        assert start["wizard"] == "owl"
        assert start["story"] == {
            "wizard": "Taara",
            "wizard_sprite": "sage",
            "scene": "library-a",
            "chapters": 5,
        }
        intro = await c.next("story")
        assert intro["kind"] == "intro" and intro["mood"] == "ask"

        q = await c.next("question")
        assert len(q["options"]) == 3
        assert ANSWERS_STORY[q["prompt"]].display_answer in q["options"]
        await c.next("listen")
        await answer(c, clean_gnani, ANSWERS_STORY[q["prompt"]].answers[0])
        assert (await c.next("result"))["correct"] is True
        beat = await c.next("story")
        assert beat["kind"] == "chapter" and beat["chapter"] == 1 and beat["mood"] == "happy"

        q2 = await c.next("question")
        await c.next("listen")
        right = ANSWERS_STORY[q2["prompt"]].display_answer
        wrong_option = next(o for o in q2["options"] if o != right)
        # Hedging with a wrong on-screen option alongside the right one is wrong.
        await answer(c, clean_gnani, f"{right} या {wrong_option}")
        assert (await c.next("result"))["correct"] is False
        setback = await c.next("story")
        assert setback["kind"] == "setback" and setback["mood"] == "sad"

        end = await c.next("story", timeout=15)
        assert end["kind"] == "ending" and end["band"] == "good"
        over = await c.next("game_over")
        assert over["character"] == "meera"
        await c.ws.close()

        async with httpx.AsyncClient(base_url=server.http) as h:
            r = await h.post(
                "/api/scores",
                headers={"Origin": ORIGIN},
                json={"score_token": over["score_token"], "nickname": "Wizard Fan"},
            )
            assert r.status_code == 200
            board = (
                await h.get("/api/leaderboard", params={"language": "hi-IN", "mode": "quiz"})
            ).json()
            assert board["entries"][0]["character"] == "meera"


async def test_unknown_character_is_refused(live):
    with live() as server:
        c = await open_game(server, await get_session(server.http))
        await c.ws.send(
            json.dumps({"type": "start", "pack_id": "hi-test-01", "character": "<script>"})
        )
        err = await c.next("error")
        assert err["code"] == "unknown_character" and err["fatal"] is False


async def test_unknown_wizard_is_refused_without_ending_the_session(live, clean_gnani):
    with live(questions_per_game=1) as server:
        c = await open_game(server, await get_session(server.http))
        await c.ws.send(json.dumps({"type": "start", "pack_id": "hi-test-01", "wizard": "dragon"}))
        err = await c.next("error")
        assert err["code"] == "unknown_character" and err["fatal"] is False
        await c.ws.send(json.dumps({"type": "start", "pack_id": "hi-test-01"}))
        start = await c.next("game_start")
        assert start["wizard"] == "sorceress"


# ---------------------------------------------------------------- adventures (§10) ---
async def test_adventure_choices_puzzle_ending_and_timed_leaderboard(live, clean_gnani):
    with live() as server:
        token = await get_session(server.http)
        c = await open_game(server, token)
        await c.ws.send(
            json.dumps(
                {
                    "type": "start_adventure",
                    "adventure": "test-quest",
                    "language": "hi-IN",
                    "character": "tara",
                    "wizard": "trickster",
                }
            )
        )
        start = await c.next("adventure_start")
        assert start["adventure"]["id"] == "test-quest" and start["routed"] is False
        assert start["wizard"] == "trickster" and start["character"] == "tara"
        assert start["meter"] == 1
        assert [e["rank"] for e in start["adventure"]["endings"]] == ["gold", "silver", "bronze"]
        greet = await c.next("wizard")
        assert greet["key"] == "greet"

        node = await c.next("node")
        assert node["id"] == "a" and node["kind"] == "choice" and node["scene"] == "lab-corridor"
        choices = await c.next("choices")
        assert [x["label"] for x in choices["choices"]] == ["Red door", "Blue door", "Green door"]

        # First try: nothing recognisable, so the wizard asks again.
        await c.next("listen")
        await answer(c, clean_gnani, "पता नहीं यार")
        unclear = await c.next("unclear")
        assert unclear["attempts_left"] == 2 and unclear["heard"] == "पता नहीं यार"
        # Second try: the card's number.
        await c.next("listen")
        await answer(c, clean_gnani, "पहला")
        chosen = await c.next("chosen")
        assert chosen == {"type": "chosen", "index": 0, "heard": "पहला", "auto": False}
        state = await c.next("state")
        assert state["meter"] == 2 and state["gained"] == ["key"]
        assert state["items"] == [{"id": "key", "label": "Brass key"}]

        node = await c.next("node")
        assert node["id"] == "b" and node["kind"] == "puzzle"
        puzzle = await c.next("puzzle")
        assert sorted(puzzle["options"]) == ["16", "4", "8"]
        await c.next("listen")
        await answer(c, clean_gnani, "आठ")
        result = await c.next("puzzle_result")
        assert result["correct"] is True and result["points"] >= 100
        assert (await c.next("wizard"))["key"] == "puzzle_right"

        ending = await c.next("ending")
        assert ending["id"] == "gold" and ending["rank"] == "gold" and ending["bonus"] == 500
        over = await c.next("game_over")
        assert over["mode"] == "adventure" and over["adventure"] == "test-quest"
        assert over["ending"] == {"id": "gold", "title": "Treasure Found", "rank": "gold"}
        assert over["score"] == result["points"] + 500
        assert over["correct"] == 1 and over["questions"] == 1
        assert 0 < over["duration_ms"] < 120_000
        await c.ws.close()

        # The choice listener asked Prisma to boost the card words.
        assert "x-bias-list" in clean_gnani.state.stt_headers[0]

        async with httpx.AsyncClient(base_url=server.http) as h:
            post = await h.post(
                "/api/scores",
                headers={"Origin": ORIGIN},
                json={"score_token": over["score_token"], "nickname": "Vector"},
            )
            assert post.status_code == 200, post.text
            assert post.json()["rank"] == 1
            board = (
                await h.get("/api/leaderboard", params={"language": "hi-IN", "period": "today"})
            ).json()
            top = board["entries"][0]
            assert top["nickname"] == "Vector" and top["adventure"] == "test-quest"
            assert top["ending"] == {"id": "gold", "rank": "gold"}
            assert top["duration_ms"] == over["duration_ms"]
            assert top["wizard"] == "trickster" and top["character"] == "tara"
            only = (
                await h.get(
                    "/api/leaderboard",
                    params={"language": "hi-IN", "period": "all", "adventure": "test-quest"},
                )
            ).json()
            assert len(only["entries"]) == 1
            quiz = (
                await h.get("/api/leaderboard", params={"language": "hi-IN", "mode": "quiz"})
            ).json()
            assert quiz["entries"] == []

            listing = (await h.get("/api/adventures", params={"language": "hi-IN"})).json()
            assert listing["auto"] is True
            assert [a["id"] for a in listing["adventures"]] == ["test-quest"]
            assert listing["adventures"][0]["meter"] == {"label": "Luck", "icon": "star", "max": 3}


async def test_auto_runs_the_prologue_then_the_picked_adventure(live, clean_gnani):
    with live() as server:
        token = await get_session(server.http)
        c = await open_game(server, token)
        await c.ws.send(
            json.dumps({"type": "start_adventure", "adventure": "auto", "language": "en-IN"})
        )
        start = await c.next("adventure_start")
        assert start["adventure"]["genre"] == "prologue" and start["wizard"] == "sorceress"
        await c.next("choices")
        await c.next("listen")
        await answer(c, clean_gnani, "at the fest of course")
        assert (await c.next("chosen"))["index"] == 1
        routed = await c.next("adventure_start")
        assert routed["routed"] is True and routed["adventure"]["id"] == "test-quest"
        await c.ws.close()


async def test_silence_three_times_lets_the_wizard_choose(live, clean_gnani):
    with live() as server:
        token = await get_session(server.http)
        c = await open_game(server, token)
        await c.ws.send(
            json.dumps({"type": "start_adventure", "adventure": "test-quest", "language": "en-IN"})
        )
        await c.next("choices")
        for left in (2, 1, 0):
            await c.next("listen")
            await answer(c, clean_gnani, "pineapple")
            assert (await c.next("unclear"))["attempts_left"] == left
        chosen = await c.next("chosen", timeout=20)
        assert chosen["auto"] is True and chosen["index"] == 0
        await c.ws.close()


async def test_bad_adventure_requests_are_refused(live, clean_gnani):
    with live() as server:
        token = await get_session(server.http)
        c = await open_game(server, token)
        for msg, code in [
            ({"adventure": "nope-nope", "language": "en-IN"}, "unknown_adventure"),
            ({"adventure": "prologue", "language": "en-IN"}, "unknown_adventure"),
            ({"adventure": "test-quest", "language": "fr-FR"}, "unknown_language"),
            (
                {"adventure": "test-quest", "language": "en-IN", "wizard": "dragon"},
                "unknown_character",
            ),
            (
                {"adventure": "test-quest", "language": "en-IN", "character": "x"},
                "unknown_character",
            ),
        ]:
            await c.ws.send(json.dumps({"type": "start_adventure", **msg}))
            err = await c.next("error")
            assert err["code"] == code and err["fatal"] is False
        await c.ws.close()


async def test_adventure_without_riddles_reaches_the_board(live, clean_gnani):
    """Some endings need no riddle at all: such a run (0 questions) must still be postable."""
    with live() as server:
        token = await get_session(server.http)
        c = await open_game(server, token)
        await c.ws.send(
            json.dumps({"type": "start_adventure", "adventure": "test-quest", "language": "en-IN"})
        )
        await c.next("choices")
        await c.next("listen")
        await answer(c, clean_gnani, "the green door please")
        assert (await c.next("chosen"))["index"] == 2
        over = await c.next("game_over")
        assert over["questions"] == 0 and over["ending"]["rank"] == "silver"
        await c.ws.close()
        async with httpx.AsyncClient(base_url=server.http) as h:
            post = await h.post(
                "/api/scores",
                headers={"Origin": ORIGIN},
                json={"score_token": over["score_token"], "nickname": "Riddleless"},
            )
            assert post.status_code == 200, post.text
            assert post.json()["rank"] == 1


async def test_next_line_waits_for_slow_live_speech_to_finish_playing(live, clean_gnani):
    # Timbre streams at half real time, so a line's audio is still playing on the client
    # long after "start + length". The next caption must not cut it off.
    clean_gnani.state.tts_audio_s = 1.0
    clean_gnani.state.tts_chunk_delay_s = 0.2
    with live() as server:
        c = await open_game(server, await get_session(server.http))
        await c.ws.send(
            json.dumps({"type": "start_adventure", "adventure": "test-quest", "language": "en-IN"})
        )
        plays_until: dict[int, float] = {}  # the client's playback end per utterance
        starts: list[tuple[int, float]] = []
        while True:
            msg = await asyncio.wait_for(c.ws.recv(), timeout=20)
            now = time.monotonic()
            if isinstance(msg, bytes):
                _, utt, _ = struct.unpack(">BHB", msg[:4])
                # Mirrors client/src/audio/player.ts: 60 ms lead, chunks back to back.
                begin = max(plays_until.get(utt, 0.0), now + 0.06)
                plays_until[utt] = begin + (len(msg) - 4) / 48000
                continue
            data = json.loads(msg)
            if data["type"] == "speak_start":
                starts.append((data["utterance"], now))
            if data["type"] == "listen":
                break
        assert len(starts) >= 2
        for (prev, _), (_, started) in itertools.pairwise(starts):
            assert started >= plays_until[prev], "next line cut off the wizard"
        await c.ws.close()


async def test_last_line_after_game_over_is_spoken_in_full(live, clean_gnani):
    # The closing line is spoken without waiting, right before game_over; closing the game's
    # TTS must not cut it off.
    clean_gnani.state.tts_audio_s = 1.0
    clean_gnani.state.tts_chunk_delay_s = 0.1
    with live(questions_per_game=1, answer_time_limit_s=1.0) as server:
        c = await open_game(server, await get_session(server.http))
        await c.ws.send(json.dumps({"type": "start", "pack_id": "hi-test-01"}))
        await c.next("listen", timeout=20)
        await stream_mic(c.ws, silence(1.5))
        await c.next("game_over", timeout=20)
        last = max(m["utterance"] for m in c.log if m["type"] == "speak_start")
        while True:
            end = await c.next("speak_end", timeout=10)
            if end["utterance"] == last:
                break
        assert end["interrupted"] is False and end["duration_ms"] >= 950
        await c.ws.close()
