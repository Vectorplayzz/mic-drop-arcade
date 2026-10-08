"""Short-lived signed tokens.

Two audiences, never interchangeable:
  * ``session`` — issued after the bot check, lets one browser open the game socket.
  * ``score``   — issued by the server at game over, carries the server-computed score; it is the
                  only way to put a row on the leaderboard, so clients cannot invent scores.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass
from typing import Any

import jwt

ALGORITHM = "HS256"
ISSUER = "maata-arcade"
_LEEWAY_S = 5


class TokenError(Exception):
    """Token missing, malformed, expired or for the wrong audience."""


@dataclass(frozen=True, slots=True)
class SessionClaims:
    session_id: str
    ip_hash: str
    expires_at: int


@dataclass(frozen=True, slots=True)
class ScoreClaims:
    game_id: str
    session_id: str
    score: int
    max_score: int
    correct: int
    questions: int
    language: str
    pack_id: str
    character: str = "arjun"
    # Adventure runs (mode "adventure"): server-timed duration, the ending reached and its
    # rank, and the narrating wizard. Quiz games leave the ending empty.
    mode: str = "quiz"
    duration_ms: int | None = None
    ending_id: str | None = None
    ending_rank: str | None = None
    wizard: str = "sorceress"


class TokenService:
    def __init__(self, secret: str, session_ttl_s: int, score_ttl_s: int) -> None:
        if len(secret) < 32:
            raise ValueError("token secret must be at least 32 characters")
        self._secret = secret
        self._session_ttl = session_ttl_s
        self._score_ttl = score_ttl_s

    # -- issuing ------------------------------------------------------------------------
    def _encode(self, aud: str, ttl: int, extra: dict[str, Any]) -> tuple[str, int]:
        now = int(time.time())
        exp = now + ttl
        payload = {
            "iss": ISSUER,
            "aud": aud,
            "iat": now,
            "nbf": now,
            "exp": exp,
            "jti": secrets.token_urlsafe(16),
            **extra,
        }
        return jwt.encode(payload, self._secret, algorithm=ALGORITHM), exp

    def issue_session(self, ip_hash: str) -> tuple[str, SessionClaims]:
        session_id = secrets.token_urlsafe(18)
        token, exp = self._encode("session", self._session_ttl, {"sid": session_id, "iph": ip_hash})
        return token, SessionClaims(session_id=session_id, ip_hash=ip_hash, expires_at=exp)

    def issue_score(self, claims: ScoreClaims) -> str:
        token, _ = self._encode(
            "score",
            self._score_ttl,
            {
                "gid": claims.game_id,
                "sid": claims.session_id,
                "sc": claims.score,
                "mx": claims.max_score,
                "co": claims.correct,
                "qn": claims.questions,
                "lang": claims.language,
                "pk": claims.pack_id,
                "ch": claims.character,
                "md": claims.mode,
                "du": claims.duration_ms,
                "en": claims.ending_id,
                "er": claims.ending_rank,
                "wz": claims.wizard,
            },
        )
        return token

    # -- verifying ----------------------------------------------------------------------
    def _decode(self, token: str, aud: str) -> dict[str, Any]:
        if not isinstance(token, str) or not token or len(token) > 2048:
            raise TokenError("missing token")
        try:
            return jwt.decode(
                token,
                self._secret,
                algorithms=[ALGORITHM],  # pinned: rejects alg=none and RS/HS confusion
                audience=aud,
                issuer=ISSUER,
                leeway=_LEEWAY_S,
                options={"require": ["exp", "iat", "nbf", "aud", "iss", "jti"]},
            )
        except jwt.PyJWTError as exc:
            raise TokenError(type(exc).__name__) from exc

    def verify_session(self, token: str) -> SessionClaims:
        data = self._decode(token, "session")
        sid, iph = data.get("sid"), data.get("iph")
        if not isinstance(sid, str) or not isinstance(iph, str):
            raise TokenError("malformed session token")
        return SessionClaims(session_id=sid, ip_hash=iph, expires_at=int(data["exp"]))

    def verify_score(self, token: str) -> tuple[ScoreClaims, str, int]:
        """Return the claims, the token's jti (for single-use enforcement) and its expiry."""
        data = self._decode(token, "score")
        try:
            claims = ScoreClaims(
                game_id=str(data["gid"]),
                session_id=str(data["sid"]),
                score=int(data["sc"]),
                max_score=int(data["mx"]),
                correct=int(data["co"]),
                questions=int(data["qn"]),
                language=str(data["lang"]),
                pack_id=str(data["pk"]),
                character=str(data.get("ch", "arjun")),
                mode=str(data.get("md", "quiz")),
                duration_ms=_opt_int(data.get("du")),
                ending_id=_opt_str(data.get("en")),
                ending_rank=_opt_str(data.get("er")),
                wizard=str(data.get("wz", "sorceress")),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise TokenError("malformed score token") from exc
        return claims, str(data["jti"]), int(data["exp"])


def _opt_int(value: Any) -> int | None:
    return None if value is None else int(value)


def _opt_str(value: Any) -> str | None:
    return None if value is None else str(value)
