"""Timbre v2.5 TTS clients.

* ``TtsStreamer`` — realtime WebSocket, one request at a time on a connection that is kept warm
  for the life of a game session. If a stream is abandoned mid-way (barge-in), the connection is
  closed because its remaining output can't be told apart from the next request's, and the next
  call reconnects.
* ``synthesize_rest`` — the REST endpoint, used offline to pre-render cached lines.

Output is always raw PCM s16le mono at 24 kHz so the browser has exactly one playback path.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import contextlib
import json
from collections.abc import AsyncIterator

import httpx
from websockets.asyncio.client import ClientConnection
from websockets.exceptions import ConnectionClosed

from app.gnani.connect import open_ws
from app.gnani.errors import GnaniAuthError, GnaniError
from app.logging import get_logger

log = get_logger(__name__)

TTS_SAMPLE_RATE = 24000
MAX_TTS_CHARS = 600
AUDIO_CONFIG = {
    "sample_rate": TTS_SAMPLE_RATE,
    "num_channels": 1,
    "sample_width": 2,
    "encoding": "pcm_s16le",
    "container": "raw",
}


def build_request(text: str, voice: str, language: str, model: str, speed: float) -> dict:
    text = text.strip()
    if not text:
        raise ValueError("empty TTS text")
    if len(text) > MAX_TTS_CHARS:
        raise ValueError("TTS text too long")
    return {
        "text": text,
        "voice": voice,
        "model": model,
        "language": language,
        "speed": max(0.85, min(1.15, speed)),
        "audio_config": AUDIO_CONFIG,
    }


class TtsStreamer:
    def __init__(
        self,
        *,
        url: str,
        api_key: str,
        model: str,
        connect_timeout_s: float = 6.0,
        connect_retries: int = 2,
        chunk_timeout_s: float = 8.0,
    ) -> None:
        self._url = url
        self._headers = {"X-API-Key-ID": api_key}
        self._model = model
        self._timeout = connect_timeout_s
        self._retries = connect_retries
        self._chunk_timeout = chunk_timeout_s
        self._ws: ClientConnection | None = None

    async def _connection(self) -> ClientConnection:
        if self._ws is None:
            self._ws = await open_ws(
                self._url,
                self._headers,
                timeout_s=self._timeout,
                retries=self._retries,
                service="tts",
            )
        return self._ws

    async def stream(
        self, text: str, *, voice: str, language: str, speed: float = 1.0
    ) -> AsyncIterator[bytes]:
        request = build_request(text, voice, language, self._model, speed)
        ws = await self._connection()
        finished = False
        try:
            try:
                await ws.send(json.dumps(request, ensure_ascii=False))
            except ConnectionClosed:
                # Warm connection went stale between rounds: reconnect once.
                await self._discard()
                ws = await self._connection()
                await ws.send(json.dumps(request, ensure_ascii=False))
            while True:
                try:
                    raw = await _recv_with_timeout(ws, self._chunk_timeout)
                except ConnectionClosed as exc:
                    raise GnaniError("tts connection dropped", retryable=True) from exc
                if isinstance(raw, bytes):
                    continue
                msg = json.loads(raw)
                kind = msg.get("type")
                if kind == "start":
                    continue
                if kind == "audio" or kind == "complete":
                    data = msg.get("data") or {}
                    b64 = data.get("audio") or ""
                    if b64:
                        try:
                            yield base64.b64decode(b64, validate=True)
                        except binascii.Error as exc:
                            raise GnaniError("tts sent invalid audio") from exc
                    if kind == "complete" or data.get("is_final"):
                        finished = True
                        return
                elif kind == "error":
                    message = str(msg.get("message") or "")
                    if "auth" in message.lower() or "key" in message.lower():
                        raise GnaniAuthError("tts rejected credentials")
                    raise GnaniError(f"tts error: {message[:120]}")
        finally:
            if not finished:
                await self._discard()

    async def _discard(self) -> None:
        ws, self._ws = self._ws, None
        if ws is not None:
            with contextlib.suppress(Exception):
                await ws.close()

    async def close(self) -> None:
        await self._discard()


async def _recv_with_timeout(ws: ClientConnection, timeout: float) -> str | bytes:
    try:
        return await asyncio.wait_for(ws.recv(), timeout=timeout)
    except TimeoutError as exc:
        raise GnaniError("tts timed out", retryable=True) from exc


async def synthesize_rest(
    client: httpx.AsyncClient,
    *,
    url: str,
    api_key: str,
    model: str,
    text: str,
    voice: str,
    language: str,
    speed: float = 1.0,
) -> bytes:
    """Return raw PCM16 24 kHz audio for ``text`` (used for offline pre-rendering)."""
    resp = await client.post(
        url,
        headers={"X-API-Key-ID": api_key},
        json=build_request(text, voice, language, model, speed),
        timeout=60.0,
    )
    if resp.status_code in (401, 403):
        raise GnaniAuthError("tts rejected credentials", status=resp.status_code)
    if resp.status_code != 200:
        raise GnaniError(
            f"tts http {resp.status_code}",
            status=resp.status_code,
            retryable=resp.status_code in (429, 500, 502, 503, 504),
        )
    return resp.content
