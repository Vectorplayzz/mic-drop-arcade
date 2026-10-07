"""Content-addressed audio cache.

Every spoken line is keyed by sha256(model | voice | language | speed | text). A line is paid
for once — at pre-render time for packs and fixed lines, or the first time it is spoken live —
and replayed from disk afterwards. Writes are atomic (temp file + rename), so a cancelled live
stream never leaves a truncated clip behind.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import os
import secrets
from pathlib import Path

MAX_CLIP_BYTES = 24000 * 2 * 60  # 60 s at 24 kHz PCM16 — far longer than any game line


def cache_key(*, model: str, voice: str, language: str, speed: float, text: str) -> str:
    material = "\x1f".join([model, voice, language, f"{speed:.2f}", text.strip()])
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


class AudioCache:
    def __init__(self, root: str | os.PathLike[str]) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        if len(key) != 64 or any(c not in "0123456789abcdef" for c in key):
            raise ValueError("invalid cache key")
        return self._root / key[:2] / f"{key}.pcm"

    def has(self, key: str) -> bool:
        return self._path(key).is_file()

    async def read(self, key: str) -> bytes | None:
        path = self._path(key)
        try:
            return await asyncio.to_thread(path.read_bytes)
        except FileNotFoundError:
            return None

    def writer(self, key: str) -> CacheWriter:
        return CacheWriter(self._path(key))

    async def put(self, key: str, pcm: bytes) -> None:
        w = self.writer(key)
        w.append(pcm)
        await w.commit()


class CacheWriter:
    def __init__(self, final_path: Path) -> None:
        self._final = final_path
        self._buf = bytearray()
        self._overflow = False

    def append(self, chunk: bytes) -> None:
        if len(self._buf) + len(chunk) > MAX_CLIP_BYTES:
            self._overflow = True
            return
        self._buf += chunk

    async def commit(self) -> bool:
        if self._overflow or not self._buf:
            return False
        await asyncio.to_thread(self._write)
        return True

    def _write(self) -> None:
        self._final.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._final.with_name(f".{self._final.name}.{secrets.token_hex(4)}.tmp")
        try:
            with open(tmp, "wb") as fh:
                fh.write(self._buf)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, self._final)
        finally:
            with contextlib.suppress(FileNotFoundError):
                tmp.unlink()
