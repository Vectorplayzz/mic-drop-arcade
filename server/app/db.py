"""Postgres access: pool, forward-only migrations and the leaderboard repository."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import asyncpg

from app.logging import get_logger
from app.security.tokens import ScoreClaims

log = get_logger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"
_MIGRATION_LOCK_ID = 7_242_001  # arbitrary constant for pg_advisory_lock

# Small, obvious blocklist; nickname moderation beyond this is part of feature #23.
_BLOCKED_FRAGMENTS = ("admin", "gnani", "moderator", "official")


async def create_pool(dsn: str) -> asyncpg.Pool:
    return await asyncpg.create_pool(
        dsn,
        min_size=1,
        max_size=10,
        command_timeout=5,
        max_inactive_connection_lifetime=300,
        server_settings={"application_name": "maata-arcade", "statement_timeout": "5000"},
    )


async def migrate(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute("SELECT pg_advisory_lock($1)", _MIGRATION_LOCK_ID)
        try:
            await conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                " name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            )
            done = {r["name"] for r in await conn.fetch("SELECT name FROM schema_migrations")}
            for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
                if path.name in done:
                    continue
                async with conn.transaction():
                    await conn.execute(path.read_text(encoding="utf-8"))
                    await conn.execute(
                        "INSERT INTO schema_migrations (name) VALUES ($1)", path.name
                    )
                log.info("migration_applied", name=path.name)
        finally:
            await conn.execute("SELECT pg_advisory_unlock($1)", _MIGRATION_LOCK_ID)


class NicknameError(ValueError):
    pass


def validate_nickname(raw: str) -> str:
    if not isinstance(raw, str):
        raise NicknameError("nickname must be text")
    nick = unicodedata.normalize("NFKC", raw).strip()
    nick = " ".join(nick.split())
    if not 3 <= len(nick) <= 16:
        raise NicknameError("nickname must be 3 to 16 characters")
    for ch in nick:
        cat = unicodedata.category(ch)
        # letters (any script), combining marks (Indic vowel signs), digits, space, _ and -
        if not (cat[0] in "LN" or cat in ("Mn", "Mc") or ch in " _-"):
            raise NicknameError("nickname may use letters, numbers, space, _ and -")
    if not any(unicodedata.category(c)[0] == "L" for c in nick):
        raise NicknameError("nickname needs at least one letter")
    lowered = re.sub(r"[\s_-]", "", nick.casefold())
    if any(b in lowered for b in _BLOCKED_FRAGMENTS):
        raise NicknameError("please choose a different nickname")
    return nick


@dataclass(frozen=True, slots=True)
class LeaderboardRow:
    rank: int
    nickname: str
    score: int
    correct: int
    questions: int
    created_at: datetime


class Leaderboard:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def insert(self, claims: ScoreClaims, nickname: str) -> bool:
        """Insert once per game; returns False if this game was already submitted."""
        row = await self._pool.fetchrow(
            "INSERT INTO scores (game_id, nickname, language, pack_id, score, max_score,"
            " correct, questions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)"
            " ON CONFLICT (game_id) DO NOTHING RETURNING id",
            claims.game_id,
            nickname,
            claims.language,
            claims.pack_id,
            claims.score,
            claims.max_score,
            claims.correct,
            claims.questions,
        )
        return row is not None

    async def top(self, language: str, *, period: str, limit: int = 20) -> list[LeaderboardRow]:
        since = datetime(1970, 1, 1, tzinfo=UTC)
        if period == "today":
            # IST calendar day
            now_ist = datetime.now(UTC) + timedelta(hours=5, minutes=30)
            since = now_ist.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(
                hours=5, minutes=30
            )
        rows = await self._pool.fetch(
            "SELECT nickname, score, correct, questions, created_at FROM scores"
            " WHERE language = $1 AND created_at >= $2"
            " ORDER BY score DESC, created_at ASC LIMIT $3",
            language,
            since,
            limit,
        )
        return [
            LeaderboardRow(
                i + 1, r["nickname"], r["score"], r["correct"], r["questions"], r["created_at"]
            )
            for i, r in enumerate(rows)
        ]

    async def ping(self) -> None:
        await self._pool.fetchval("SELECT 1")
