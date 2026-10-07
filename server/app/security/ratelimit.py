"""Redis-backed rate limits and usage caps.

Fixed windows via an atomic Lua script (INCR + EXPIRE in one round trip), so concurrent requests
cannot race past a limit. Float counters (audio seconds) use INCRBYFLOAT the same way.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from redis.asyncio import Redis

_INCR_WINDOW = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
"""

_INCRBYFLOAT_CAPPED = """
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local add = tonumber(ARGV[1])
local cap = tonumber(ARGV[2])
if current + add > cap then
  return {0, tostring(current)}
end
local updated = redis.call('INCRBYFLOAT', KEYS[1], ARGV[1])
if current == 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[3])
end
return {1, tostring(updated)}
"""


@dataclass(frozen=True, slots=True)
class LimitResult:
    allowed: bool
    count: int
    limit: int
    retry_after_s: int


class RateLimiter:
    def __init__(self, redis: Redis, prefix: str = "rl") -> None:
        self._redis = redis
        self._prefix = prefix
        self._incr = redis.register_script(_INCR_WINDOW)
        self._incr_float = redis.register_script(_INCRBYFLOAT_CAPPED)

    async def hit(self, bucket: str, identity: str, limit: int, window_s: int = 60) -> LimitResult:
        now = int(time.time())
        window = now // window_s
        key = f"{self._prefix}:{bucket}:{identity}:{window}"
        count = int(await self._incr(keys=[key], args=[window_s + 1]))
        retry = (window + 1) * window_s - now
        return LimitResult(count <= limit, count, limit, max(retry, 1))

    async def consume_float(
        self, bucket: str, identity: str, amount: float, cap: float, ttl_s: int
    ) -> tuple[bool, float]:
        """Add ``amount`` unless that would exceed ``cap``. Returns (allowed, current_total)."""
        key = f"{self._prefix}:{bucket}:{identity}"
        ok, total = await self._incr_float(keys=[key], args=[repr(amount), repr(cap), ttl_s])
        return bool(int(ok)), float(total)


def day_key(ts: float | None = None) -> str:
    """UTC+5:30 calendar day, so 'daily' limits reset at midnight IST for our players."""
    t = (ts if ts is not None else time.time()) + 5.5 * 3600
    return time.strftime("%Y%m%d", time.gmtime(t))


def seconds_until_ist_midnight(ts: float | None = None) -> int:
    t = (ts if ts is not None else time.time()) + 5.5 * 3600
    return int(86400 - (t % 86400)) + 1
