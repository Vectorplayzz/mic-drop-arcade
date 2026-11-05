"""Per-voice loudness trim for streamed speech.

Timbre's voices do not come out at the same level: Falak (the Sorceress) arrives about 14 dB
quieter than the other wizards' voices. The fix is applied on the way to the client, so the
audio cache keeps Timbre's original clips and a trim can be changed without re-rendering
anything. A soft knee above -3 dBFS keeps the occasional boosted peak from clipping.
"""

from __future__ import annotations

import math
import sys
from array import array

_FULL = 32767.0
_KNEE = 0.70 * _FULL  # about -3 dBFS: below this the gain is exactly linear
_CEIL = 0.97 * _FULL  # the limiter never goes past this


def _limit(x: float) -> float:
    a = abs(x)
    if a <= _KNEE:
        return x
    span = _CEIL - _KNEE
    y = _KNEE + span * math.tanh((a - _KNEE) / span)
    return y if x > 0 else -y


class Gain:
    """Applies a fixed gain (dB) to a stream of little-endian PCM16 chunks.

    Chunks may split a sample across a boundary; the odd byte is carried to the next chunk.
    """

    def __init__(self, db: float) -> None:
        if not math.isfinite(db) or not -24.0 <= db <= 24.0:
            raise ValueError("gain must be within ±24 dB")
        self._k = 10 ** (db / 20)
        self._carry = b""

    @property
    def unity(self) -> bool:
        return self._k == 1.0

    def __call__(self, chunk: bytes) -> bytes:
        if self.unity:
            return chunk
        data = self._carry + chunk
        whole = len(data) - (len(data) & 1)
        self._carry = data[whole:]
        samples = array("h")
        samples.frombytes(data[:whole])
        if sys.byteorder == "big":
            samples.byteswap()
        k = self._k
        out = array("h", (round(_limit(s * k)) for s in samples))
        if sys.byteorder == "big":
            out.byteswap()
        return out.tobytes()
