"""End-to-end: browser client ↔ real app (uvicorn) ↔ protocol-faithful Gnani mocks,
with real Redis and Postgres."""

from __future__ import annotations

import asyncio
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
                await h.get("/api/leaderboard", params={"language": "hi-IN", "period": "today"})
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
            json.dumps({"type": "start", "pack_id": "hi-story-01", "character": "meera"})
        )
        start = await c.next("game_start")
        assert start["character"] == "meera"
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
            board = (await h.get("/api/leaderboard", params={"language": "hi-IN"})).json()
            assert board["entries"][0]["character"] == "meera"


async def test_unknown_character_is_refused(live):
    with live() as server:
        c = await open_game(server, await get_session(server.http))
        await c.ws.send(
            json.dumps({"type": "start", "pack_id": "hi-test-01", "character": "<script>"})
        )
        err = await c.next("error")
        assert err["code"] == "unknown_character" and err["fatal"] is False
