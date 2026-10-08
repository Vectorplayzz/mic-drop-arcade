"""Credit budget: metering, daily cap, alerts and kill switch.

Every paid call (seconds of audio streamed to Prisma, characters synthesised live by Timbre)
is charged to a per-day ledger in Redis before or as it happens. When the day's budget or the
programme total is spent, or an operator flips the kill switch, new rounds are refused and the
client shows a "come back tomorrow" screen. Alerts fire once per threshold per day.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

import httpx
from redis.asyncio import Redis

from app.logging import get_logger
from app.security.ratelimit import day_key

log = get_logger(__name__)

KILL_SWITCH_KEY = "maata:killswitch"
TOTAL_KEY = "maata:credits:total"
ALERT_THRESHOLDS = (0.5, 0.8, 1.0)


def _daily_key(day: str) -> str:
    return f"maata:credits:day:{day}"


@dataclass(frozen=True, slots=True)
class BudgetStatus:
    open: bool
    reason: str | None
    spent_today: float
    daily_budget: float
    spent_total: float
    credits_total: float


class CreditBudget:
    def __init__(
        self,
        redis: Redis,
        *,
        daily_budget: float,
        credits_total: float,
        credits_per_stt_minute: float,
        credits_per_1k_tts_chars: float,
        env_kill_switch: bool,
        http: httpx.AsyncClient | None = None,
        alert_webhook_url: str = "",
    ) -> None:
        self._redis = redis
        self._daily = daily_budget
        self._total = credits_total
        self._stt_rate = credits_per_stt_minute
        self._tts_rate = credits_per_1k_tts_chars
        self._env_kill = env_kill_switch
        self._http = http
        self._webhook = alert_webhook_url
        self._alert_tasks: set[asyncio.Task[None]] = set()

    # -- pricing ------------------------------------------------------------------------
    def stt_cost(self, audio_seconds: float) -> float:
        return audio_seconds / 60.0 * self._stt_rate

    def tts_cost(self, chars: int) -> float:
        return chars / 1000.0 * self._tts_rate

    # -- state --------------------------------------------------------------------------
    async def status(self) -> BudgetStatus:
        day = day_key()
        kill, spent_today, spent_total = await self._redis.mget(
            KILL_SWITCH_KEY, _daily_key(day), TOTAL_KEY
        )
        today = float(spent_today or 0.0)
        total = float(spent_total or 0.0)
        reason: str | None = None
        if self._env_kill or kill in (b"1", "1"):
            reason = "kill_switch"
        elif total >= self._total:
            reason = "credits_exhausted"
        elif today >= self._daily:
            reason = "daily_budget_exhausted"
        return BudgetStatus(reason is None, reason, today, self._daily, total, self._total)

    async def is_open(self) -> bool:
        return (await self.status()).open

    async def charge(self, credits: float, *, kind: str) -> None:
        if credits <= 0:
            return
        day = day_key()
        pipe = self._redis.pipeline(transaction=True)
        pipe.incrbyfloat(_daily_key(day), credits)
        pipe.expire(_daily_key(day), 8 * 86400)
        pipe.incrbyfloat(TOTAL_KEY, credits)
        today, _, total = await pipe.execute()
        await self._maybe_alert(day, float(today), float(total), kind)

    async def set_kill_switch(self, on: bool) -> None:
        if on:
            await self._redis.set(KILL_SWITCH_KEY, "1")
        else:
            await self._redis.delete(KILL_SWITCH_KEY)
        log.warning("kill_switch_changed", on=on)

    # -- alerts -------------------------------------------------------------------------
    async def _maybe_alert(self, day: str, today: float, total: float, kind: str) -> None:
        for scope, spent, cap in (("daily", today, self._daily), ("total", total, self._total)):
            if cap <= 0:
                continue
            for threshold in ALERT_THRESHOLDS:
                if spent < cap * threshold:
                    continue
                marker = f"maata:alert:{scope}:{int(threshold * 100)}"
                if scope == "daily":
                    marker += f":{day}"
                if await self._redis.set(marker, "1", nx=True, ex=9 * 86400):
                    msg = (
                        f"Mic Drop Arcade: {scope} credit usage at {int(threshold * 100)}% "
                        f"({spent:.1f} of {cap:.0f}); last charge from {kind}."
                    )
                    log.warning("credit_alert", scope=scope, threshold=threshold, spent=spent)
                    self._fire_webhook(msg)

    def _fire_webhook(self, message: str) -> None:
        if not (self._webhook and self._http):
            return
        task = asyncio.create_task(self._post(message))
        self._alert_tasks.add(task)
        task.add_done_callback(self._alert_tasks.discard)

    async def _post(self, message: str) -> None:
        assert self._http is not None
        try:
            await self._http.post(self._webhook, json={"content": message[:1900]}, timeout=5.0)
        except httpx.HTTPError as exc:
            log.error("alert_webhook_failed", error=type(exc).__name__)
