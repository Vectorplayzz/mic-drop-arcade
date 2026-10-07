"""Prisma v2.5 realtime STT client (server side of the browser→Prisma proxy).

Prisma accepts exactly 1,024-byte PCM frames (512 samples) at real-time cadence and pushes back
``processing`` (end of speech detected) and ``transcript`` (one per VAD segment) messages.
Browsers send whatever buffer size their AudioWorklet produces, so this module re-frames the
audio and paces it against a wall clock, re-anchoring when the client stalls rather than
bursting a backlog at Prisma.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from collections import deque
from dataclasses import dataclass
from typing import Literal

from websockets.asyncio.client import ClientConnection
from websockets.exceptions import ConnectionClosed

from app.gnani.connect import open_ws
from app.gnani.errors import GnaniError
from app.logging import get_logger

log = get_logger(__name__)

FRAME_BYTES = 1024
SAMPLES_PER_FRAME = FRAME_BYTES // 2
# If the sender falls further behind wall-clock than this, it re-anchors instead of bursting.
MAX_LAG_S = 0.25
# Hard bound on buffered-but-unsent audio; beyond this the oldest frames are dropped.
MAX_BUFFERED_S = 3.0


@dataclass(frozen=True, slots=True)
class SttEvent:
    kind: Literal["processing", "transcript", "error", "closed"]
    text: str = ""
    audio_duration_ms: int = 0
    latency_ms: int = 0
    message: str = ""


class PcmFramer:
    """Accumulate arbitrary-size PCM16 chunks and emit fixed 1,024-byte frames."""

    def __init__(self) -> None:
        self._buf = bytearray()

    def push(self, chunk: bytes) -> list[bytes]:
        self._buf += chunk
        n = len(self._buf) // FRAME_BYTES
        frames = [bytes(self._buf[i * FRAME_BYTES : (i + 1) * FRAME_BYTES]) for i in range(n)]
        del self._buf[: n * FRAME_BYTES]
        return frames

    def flush(self) -> bytes | None:
        """Zero-pad the remainder into one last frame, if any audio is left."""
        if not self._buf:
            return None
        frame = bytes(self._buf) + b"\x00" * (FRAME_BYTES - len(self._buf))
        self._buf.clear()
        return frame


class SttStream:
    def __init__(
        self,
        *,
        url: str,
        api_key: str,
        language: str,
        sample_rate: int = 16000,
        min_silence_ms: int = 450,
        vad_threshold: float = 0.7,
        max_speech_s: float = 15.0,
        bias_words: list[str] | None = None,
        connect_timeout_s: float = 6.0,
        connect_retries: int = 2,
    ) -> None:
        if sample_rate not in (8000, 16000):
            raise ValueError("sample_rate must be 8000 or 16000")
        self._url = url
        self._headers = {
            "x-api-key-id": api_key,
            "lang_code": language,
            "x-sample-rate": str(sample_rate),
            "x-format": "transcribe",  # ITN: spoken numbers come back as digits
            "x-vad-threshold": str(vad_threshold),
            "x-min-silence-ms": str(min_silence_ms),
            "x-max-speech-s": str(max_speech_s),
        }
        if bias_words:
            words = [w for w in bias_words if w.isalpha()][:100]
            if words:
                self._headers["x-bias-list"] = json.dumps(words, ensure_ascii=False)
                self._headers["x-bias-score"] = "1.5"
        self._frame_s = SAMPLES_PER_FRAME / sample_rate
        self._max_frames = int(MAX_BUFFERED_S / self._frame_s)
        self._timeout = connect_timeout_s
        self._retries = connect_retries
        self._framer = PcmFramer()
        self._frames: deque[bytes] = deque()
        self._have_frames = asyncio.Event()
        self._ws: ClientConnection | None = None
        self._tasks: list[asyncio.Task[None]] = []
        self._closed = False
        self.events: asyncio.Queue[SttEvent] = asyncio.Queue()
        self.frames_sent = 0
        self.frames_dropped = 0

    @property
    def audio_seconds_sent(self) -> float:
        return self.frames_sent * self._frame_s

    async def open(self) -> None:
        ws = await open_ws(
            self._url,
            self._headers,
            timeout_s=self._timeout,
            retries=self._retries,
            service="stt",
            max_size=256 * 1024,
        )
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=self._timeout)
            msg = json.loads(raw)
            if msg.get("type") != "connected":
                raise GnaniError(f"stt unexpected first message: {msg.get('type')!r}")
        except (TimeoutError, ConnectionClosed, ValueError) as exc:
            await ws.close()
            raise GnaniError("stt did not confirm connection", retryable=True) from exc
        except GnaniError:
            await ws.close()
            raise
        self._ws = ws
        self._tasks = [
            asyncio.create_task(self._send_loop(), name="stt-send"),
            asyncio.create_task(self._recv_loop(), name="stt-recv"),
        ]

    def feed(self, pcm: bytes) -> None:
        if self._closed:
            return
        for frame in self._framer.push(pcm):
            self._frames.append(frame)
        while len(self._frames) > self._max_frames:
            self._frames.popleft()
            self.frames_dropped += 1
        if self._frames:
            self._have_frames.set()

    async def _send_loop(self) -> None:
        assert self._ws is not None
        anchor = 0.0
        sent_since_anchor = 0
        try:
            while not self._closed:
                if not self._frames:
                    self._have_frames.clear()
                    await self._have_frames.wait()
                    continue
                now = time.monotonic()
                due = anchor + sent_since_anchor * self._frame_s
                if sent_since_anchor == 0 or now - due > MAX_LAG_S:
                    anchor, sent_since_anchor, due = now, 0, now
                if due > now:
                    await asyncio.sleep(due - now)
                frame = self._frames.popleft()
                await self._ws.send(frame)
                sent_since_anchor += 1
                self.frames_sent += 1
        except ConnectionClosed:
            pass

    async def _recv_loop(self) -> None:
        assert self._ws is not None
        try:
            async for raw in self._ws:
                if isinstance(raw, bytes):
                    continue
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                kind = msg.get("type")
                if kind == "processing":
                    await self.events.put(SttEvent("processing"))
                elif kind == "transcript":
                    await self.events.put(
                        SttEvent(
                            "transcript",
                            text=str(msg.get("text") or "")[:500],
                            audio_duration_ms=int(msg.get("audio_duration_ms") or 0),
                            latency_ms=int(msg.get("latency") or 0),
                        )
                    )
                elif kind == "error":
                    log.warning("stt_server_error")
                    await self.events.put(
                        SttEvent("error", message=str(msg.get("message") or "")[:200])
                    )
        except ConnectionClosed as exc:
            if not self._closed:
                log.warning("stt_closed_by_server", code=exc.rcvd.code if exc.rcvd else None)
        finally:
            await self.events.put(SttEvent("closed"))

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._have_frames.set()
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        if self._ws is not None:
            with contextlib.suppress(Exception):
                await self._ws.close()
