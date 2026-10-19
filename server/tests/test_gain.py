"""Per-voice loudness trim (app/voice/gain.py)."""

from __future__ import annotations

import math
from array import array

import pytest

from app.game.languages import VOICE_GAIN_DB, WIZARD_VOICES
from app.voice.gain import Gain


def pcm(samples: list[int]) -> bytes:
    return array("h", samples).tobytes()


def samples(data: bytes) -> list[int]:
    a = array("h")
    a.frombytes(data)
    return list(a)


def test_unity_gain_passes_bytes_through() -> None:
    data = pcm([0, 1000, -1000, 32767, -32768])
    assert Gain(0.0)(data) is data


def test_quiet_audio_is_scaled_linearly() -> None:
    out = samples(Gain(12.0)(pcm([0, 1000, -1000, 2000])))
    k = 10 ** (12 / 20)
    assert out == [0, round(1000 * k), round(-1000 * k), round(2000 * k)]


def test_loud_peaks_are_limited_not_clipped() -> None:
    out = samples(Gain(12.0)(pcm([30000, -30000, 8000])))
    assert all(abs(s) <= int(0.97 * 32767) + 1 for s in out)
    assert out[0] > out[2] > 0 and out[1] < 0  # order and sign survive


def test_odd_chunk_boundaries_are_carried() -> None:
    data = pcm(list(range(-500, 500, 7)))
    g_whole, g_split = Gain(6.0), Gain(6.0)
    whole = g_whole(data)
    split = b"".join(g_split(data[i : i + 5]) for i in range(0, len(data), 5))
    assert split == whole


@pytest.mark.parametrize("db", [math.nan, math.inf, 30.0, -30.0])
def test_unreasonable_gain_is_rejected(db: float) -> None:
    with pytest.raises(ValueError):
        Gain(db)


def test_trims_name_cast_voices() -> None:
    cast = {v for voices in WIZARD_VOICES.values() for v in voices.values()}
    assert set(VOICE_GAIN_DB) <= cast
