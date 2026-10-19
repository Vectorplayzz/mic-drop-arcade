"""Process-wide services, built once at startup and shared by HTTP and WebSocket handlers."""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import httpx
from redis.asyncio import Redis

from app.budget import CreditBudget
from app.config import Settings
from app.db import Leaderboard
from app.game.adventures import AdventureLibrary
from app.game.lines import Lines
from app.game.packs import PackLibrary
from app.game.wizards import WizardLines
from app.gnani.stt import SttStream
from app.gnani.tts import TtsStreamer
from app.security.ratelimit import RateLimiter
from app.security.tokens import TokenService
from app.security.turnstile import TurnstileVerifier
from app.voice.cache import AudioCache

_ACQUIRE_SLOT = """
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1] - ARGV[3])
if redis.call('ZSCORE', KEYS[1], ARGV[4]) then
  redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
  return 1
end
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then
  return 0
end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
return 1
"""

_RELEASE_IF_OWNER = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""

_REFRESH_IF_OWNER = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 0
"""

ACTIVE_GAMES_KEY = "maata:active_games"
SLOT_STALE_S = 120


class Slots:
    """Global concurrent-game cap and one-socket-per-session locks, both crash-safe via TTLs."""

    def __init__(self, redis: Redis, max_games: int) -> None:
        self._redis = redis
        self._max = max_games
        self._acquire = redis.register_script(_ACQUIRE_SLOT)
        self._release = redis.register_script(_RELEASE_IF_OWNER)
        self._refresh = redis.register_script(_REFRESH_IF_OWNER)

    async def acquire_game(self, game_id: str) -> bool:
        now = time.time()
        ok = await self._acquire(
            keys=[ACTIVE_GAMES_KEY], args=[now, self._max, SLOT_STALE_S, game_id]
        )
        return bool(int(ok))

    async def heartbeat_game(self, game_id: str) -> None:
        await self._redis.zadd(ACTIVE_GAMES_KEY, {game_id: time.time()}, xx=True)

    async def release_game(self, game_id: str) -> None:
        await self._redis.zrem(ACTIVE_GAMES_KEY, game_id)

    async def active_games(self) -> int:
        await self._redis.zremrangebyscore(ACTIVE_GAMES_KEY, "-inf", time.time() - SLOT_STALE_S)
        return int(await self._redis.zcard(ACTIVE_GAMES_KEY))

    async def lock_session(self, session_id: str, owner: str, ttl_s: int = 60) -> bool:
        return bool(await self._redis.set(f"maata:ws:{session_id}", owner, nx=True, ex=ttl_s))

    async def refresh_session(self, session_id: str, owner: str, ttl_s: int = 60) -> None:
        await self._refresh(keys=[f"maata:ws:{session_id}"], args=[owner, ttl_s])

    async def unlock_session(self, session_id: str, owner: str) -> None:
        await self._release(keys=[f"maata:ws:{session_id}"], args=[owner])


@dataclass
class Deps:
    settings: Settings
    redis: Redis
    http: httpx.AsyncClient
    limiter: RateLimiter
    tokens: TokenService
    turnstile: TurnstileVerifier
    budget: CreditBudget
    slots: Slots
    cache: AudioCache
    packs: PackLibrary
    lines: Lines
    leaderboard: Leaderboard | None
    adventures: AdventureLibrary = field(default_factory=lambda: AdventureLibrary({}))
    wizards: WizardLines | None = None  # type: ignore[assignment]
    started_at: float = field(default_factory=time.time)

    def new_stt(
        self, *, language: str, sample_rate: int = 16000, bias_words: list[str] | None = None
    ) -> SttStream:
        s = self.settings
        return SttStream(
            url=s.gnani_stt_ws_url,
            api_key=s.gnani_api_key.get_secret_value(),
            language=language,
            sample_rate=sample_rate,
            min_silence_ms=s.stt_min_silence_ms,
            vad_threshold=s.stt_vad_threshold,
            bias_words=bias_words,
            connect_timeout_s=s.gnani_connect_timeout_s,
            connect_retries=min(s.gnani_connect_retries, 2),
        )

    def new_tts(self) -> TtsStreamer:
        s = self.settings
        return TtsStreamer(
            url=s.gnani_tts_ws_url,
            api_key=s.tts_api_key,
            model=s.gnani_tts_model,
            connect_timeout_s=s.gnani_connect_timeout_s,
            connect_retries=min(s.gnani_connect_retries, 2),
        )
