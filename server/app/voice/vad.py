"""Lightweight start-of-speech detector for barge-in.

Prisma's VAD only reports *end* of speech, so we need our own signal for "the player started
talking over the question". An energy detector with an adaptive noise floor and hysteresis is
enough here: the browser already applies echo cancellation and noise suppression, and a false
trigger only stops the question audio early (the player has already heard most of it).
"""

from __future__ import annotations

import math
import sys
from array import array


def rms_dbfs(pcm16: bytes) -> float:
    if len(pcm16) < 2:
        return -120.0
    samples = array("h")
    samples.frombytes(pcm16[: len(pcm16) - (len(pcm16) % 2)])
    if sys.byteorder == "big":
        samples.byteswap()
    total = 0
    for s in samples:
        total += s * s
    mean = total / len(samples)
    if mean <= 0:
        return -120.0
    return 10.0 * math.log10(mean / (32768.0 * 32768.0))


class BargeInDetector:
    def __init__(
        self,
        *,
        sample_rate: int = 16000,
        margin_db: float = 15.0,
        min_level_dbfs: float = -45.0,
        trigger_ms: int = 160,
        floor_init_dbfs: float = -60.0,
    ) -> None:
        self._sr = sample_rate
        self._margin = margin_db
        self._min_level = min_level_dbfs
        self._trigger_ms = trigger_ms
        self._floor = floor_init_dbfs
        self._speech_ms = 0.0

    @property
    def noise_floor_dbfs(self) -> float:
        return self._floor

    def reset(self) -> None:
        self._speech_ms = 0.0

    def update(self, pcm16: bytes) -> bool:
        """Feed one chunk; returns True once sustained speech is detected."""
        dur_ms = (len(pcm16) // 2) / self._sr * 1000.0
        level = rms_dbfs(pcm16)
        threshold = max(self._floor + self._margin, self._min_level)
        if level >= threshold:
            self._speech_ms += dur_ms
        else:
            # Decay instead of hard reset so one quiet frame mid-word doesn't restart the count.
            self._speech_ms = max(0.0, self._speech_ms - dur_ms * 2)
            # Track the floor only on non-speech frames: fast down, slow up.
            alpha = 0.3 if level < self._floor else 0.02
            self._floor = (1 - alpha) * self._floor + alpha * level
            self._floor = max(-90.0, min(self._floor, -30.0))
        return self._speech_ms >= self._trigger_ms
