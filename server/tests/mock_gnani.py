"""Protocol-faithful stand-ins for Gnani's realtime STT and TTS WebSockets.

They implement the documented wire contracts (docs.gnani.ai, Oct 2026) strictly — including
auth header checks, the exact 1,024-byte frame rule and real-time cadence — so the tests catch
violations the real service would reject. They are test fixtures, not part of the product.
"""

from __future__ import annotations

import asyncio
import base64
import json
import math
import struct
import threading
import time
from dataclasses import dataclass, field
from http import HTTPStatus

from websockets.asyncio.server import ServerConnection, serve
from websockets.datastructures import Headers
from websockets.http11 import Request, Response

API_KEY = "test-gnani-key"


def tone(seconds: float, rate: int = 16000, amp: int = 8000, freq: float = 220.0) -> bytes:
    n = int(seconds * rate)
    return b"".join(
        struct.pack("<h", int(amp * math.sin(2 * math.pi * freq * i / rate))) for i in range(n)
    )


def silence(seconds: float, rate: int = 16000) -> bytes:
    return b"\x00\x00" * int(seconds * rate)


def _reject(status: HTTPStatus) -> Response:
    return Response(status.value, status.phrase, Headers(), b"")


@dataclass
class MockState:
    transcripts: list[str] = field(default_factory=list)
    stt_headers: list[dict[str, str]] = field(default_factory=list)
    stt_frame_times: list[float] = field(default_factory=list)
    stt_violations: list[str] = field(default_factory=list)
    stt_connections: int = 0
    tts_requests: list[dict] = field(default_factory=list)
    tts_chunk_delay_s: float = 0.0
    tts_audio_s: float = 0.4
    fail_stt_handshake_status: int | None = None


class MockGnani:
    """Runs both mock services on one background event loop thread."""

    def __init__(self) -> None:
        self.state = MockState()
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._ready = threading.Event()
        self.stt_url = ""
        self.tts_url = ""

    # ---------------------------------------------------------------- lifecycle --
    def start(self) -> MockGnani:
        self._thread.start()
        self._ready.wait(5)
        return self

    def stop(self) -> None:
        self._loop.call_soon_threadsafe(self._stop.set)
        self._thread.join(5)

    def _run(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._main())

    async def _main(self) -> None:
        self._stop = asyncio.Event()
        async with (
            serve(self._stt, "127.0.0.1", 0, process_request=self._stt_auth) as stt,
            serve(self._tts, "127.0.0.1", 0, process_request=self._tts_auth) as tts,
        ):
            self.stt_url = f"ws://127.0.0.1:{stt.sockets[0].getsockname()[1]}/stt/v3/stream"
            self.tts_url = f"ws://127.0.0.1:{tts.sockets[0].getsockname()[1]}/api/v1/tts"
            self._ready.set()
            await self._stop.wait()

    # ---------------------------------------------------------------- STT --------
    def _stt_auth(self, conn: ServerConnection, request: Request) -> Response | None:
        if self.state.fail_stt_handshake_status:
            return _reject(HTTPStatus(self.state.fail_stt_handshake_status))
        if request.headers.get("x-api-key-id") != API_KEY:
            return _reject(HTTPStatus.UNAUTHORIZED)
        if not request.headers.get("lang_code"):
            return _reject(HTTPStatus.BAD_REQUEST)
        return None

    async def _stt(self, ws: ServerConnection) -> None:
        st = self.state
        st.stt_connections += 1
        st.stt_headers.append(dict(ws.request.headers.raw_items()))
        rate = int(ws.request.headers.get("x-sample-rate", "16000"))
        silence_needed = int(ws.request.headers.get("x-min-silence-ms", "500"))
        frame_ms = 512 / rate * 1000
        await ws.send(
            json.dumps(
                {
                    "type": "connected",
                    "message": "STT service ready",
                    "config": {"sample_rate": rate, "chunk_size": 512},
                }
            )
        )
        speech_ms = 0.0
        quiet_ms = 0.0
        async for msg in ws:
            if isinstance(msg, str):
                continue
            st.stt_frame_times.append(time.monotonic())
            if len(msg) != 1024:
                st.stt_violations.append(f"frame size {len(msg)}")
                await ws.send(json.dumps({"type": "error", "message": "bad frame size"}))
                continue
            samples = struct.unpack("<512h", msg)
            loud = max(abs(s) for s in samples) > 2000
            if loud:
                speech_ms += frame_ms
                quiet_ms = 0.0
            elif speech_ms > 0:
                quiet_ms += frame_ms
                if quiet_ms >= silence_needed:
                    await ws.send(json.dumps({"type": "processing"}))
                    text = st.transcripts.pop(0) if st.transcripts else ""
                    await asyncio.sleep(0.05)
                    await ws.send(
                        json.dumps(
                            {
                                "type": "transcript",
                                "text": text,
                                "audio_duration_ms": int(speech_ms),
                                "segment_id": "s",
                                "segment_index": 0,
                                "latency": 50,
                            }
                        )
                    )
                    speech_ms = quiet_ms = 0.0

    # ---------------------------------------------------------------- TTS --------
    def _tts_auth(self, conn: ServerConnection, request: Request) -> Response | None:
        if request.headers.get("x-api-key-id") != API_KEY:
            return _reject(HTTPStatus.UNAUTHORIZED)
        return None

    async def _tts(self, ws: ServerConnection) -> None:
        st = self.state
        async for msg in ws:
            req = json.loads(msg)
            st.tts_requests.append(req)
            cfg = req.get("audio_config", {})
            if not req.get("text") or not req.get("voice") or cfg.get("container") != "raw":
                await ws.send(json.dumps({"type": "error", "message": "invalid request"}))
                continue
            await ws.send(json.dumps({"type": "start", "request_id": "req_1"}))
            pcm = tone(st.tts_audio_s, rate=cfg["sample_rate"], amp=3000)
            step = 4800
            for i in range(0, len(pcm), step):
                await asyncio.sleep(st.tts_chunk_delay_s)
                await ws.send(
                    json.dumps(
                        {
                            "type": "audio",
                            "data": {
                                "chunk_index": i // step,
                                "audio": base64.b64encode(pcm[i : i + step]).decode(),
                                "is_final": False,
                            },
                        }
                    )
                )
            await ws.send(
                json.dumps(
                    {"type": "complete", "data": {"chunk_index": -1, "audio": "", "is_final": True}}
                )
            )
