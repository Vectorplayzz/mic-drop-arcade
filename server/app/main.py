"""FastAPI application: HTTP API + the game WebSocket."""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Literal

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.budget import CreditBudget
from app.config import Settings, get_settings
from app.db import Leaderboard, NicknameError, create_pool, migrate, validate_nickname
from app.deps import Deps, Slots
from app.game.languages import LANGUAGES
from app.game.lines import Lines
from app.game.packs import PackLibrary
from app.logging import configure_logging, get_logger
from app.security.client_ip import hash_ip, resolve_client_ip
from app.security.http import SecurityHeadersMiddleware, origin_allowed
from app.security.ratelimit import RateLimiter
from app.security.tokens import TokenError, TokenService
from app.security.turnstile import TurnstileVerifier
from app.voice.cache import AudioCache
from app.ws.play import PlaySession

log = get_logger(__name__)

MAX_BODY_BYTES = 8 * 1024


async def build_deps(
    settings: Settings, http: httpx.AsyncClient | None = None
) -> tuple[Deps, list]:
    redis = Redis.from_url(
        settings.redis_url, socket_timeout=3, socket_connect_timeout=3, health_check_interval=30
    )
    http = http or httpx.AsyncClient(
        timeout=httpx.Timeout(10.0, connect=5.0),
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        follow_redirects=False,
    )
    pool = await create_pool(settings.database_url)
    await migrate(pool)
    deps = Deps(
        settings=settings,
        redis=redis,
        http=http,
        limiter=RateLimiter(redis),
        tokens=TokenService(
            settings.jwt_secret.get_secret_value(),
            settings.session_ttl_s,
            settings.score_token_ttl_s,
        ),
        turnstile=TurnstileVerifier(
            http, settings.turnstile_secret.get_secret_value(), settings.turnstile_hostname
        ),
        budget=CreditBudget(
            redis,
            daily_budget=settings.daily_credit_budget,
            credits_total=settings.credits_total,
            credits_per_stt_minute=settings.credits_per_stt_minute,
            credits_per_1k_tts_chars=settings.credits_per_1k_tts_chars,
            env_kill_switch=settings.kill_switch,
            http=http,
            alert_webhook_url=settings.alert_webhook_url.get_secret_value(),
        ),
        slots=Slots(redis, settings.max_concurrent_games),
        cache=AudioCache(settings.audio_cache_dir),
        packs=PackLibrary.load(settings.packs_dir, require_review=settings.env == "production"),
        lines=Lines.load(settings.lines_file),
        leaderboard=Leaderboard(pool),
    )
    return deps, [redis.aclose, http.aclose, pool.close]


def create_app(
    settings: Settings | None = None, *, http_client: httpx.AsyncClient | None = None
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.deps, closers = await build_deps(settings, http_client)
        log.info("startup", env=settings.env, packs=len(app.state.deps.packs.list()))
        try:
            yield
        finally:
            for close in closers:
                await close()

    is_prod = settings.env == "production"
    app = FastAPI(
        title="Mic Drop Arcade",
        lifespan=lifespan,
        docs_url=None if is_prod else "/api/docs",
        redoc_url=None,
        openapi_url=None if is_prod else "/api/openapi.json",
    )
    app.add_middleware(SecurityHeadersMiddleware, hsts=is_prod)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, __: RequestValidationError) -> JSONResponse:
        # Don't echo the offending input back.
        return JSONResponse({"error": "invalid_request"}, status_code=422)

    @app.exception_handler(RedisError)
    async def _redis_down(_: Request, __: RedisError) -> JSONResponse:
        log.error("redis_unavailable")
        return JSONResponse({"error": "unavailable"}, status_code=503)

    _register_routes(app)
    return app


# ---------------------------------------------------------------------- dependencies --
def get_deps(request: Request) -> Deps:
    return request.app.state.deps


DepsDep = Annotated[Deps, Depends(get_deps)]


def _ip_hash(request: Request, deps: Deps) -> tuple[str, str]:
    ip = resolve_client_ip(request, deps.settings.trusted_proxies)
    return ip, hash_ip(ip, deps.settings.ip_hash_secret.get_secret_value())


async def _limit(deps: Deps, bucket: str, identity: str, limit: int) -> None:
    result = await deps.limiter.hit(bucket, identity, limit)
    if not result.allowed:
        raise HTTPException(429, "rate_limited", headers={"Retry-After": str(result.retry_after_s)})


def _require_origin(request: Request, deps: Deps) -> None:
    if not origin_allowed(request.headers.get("origin"), deps.settings.allowed_origins):
        raise HTTPException(403, "forbidden_origin")


def _require_small_body(request: Request) -> None:
    length = request.headers.get("content-length")
    if length is None or not length.isdigit() or int(length) > MAX_BODY_BYTES:
        raise HTTPException(413, "body_too_large")


# ---------------------------------------------------------------------- models --------
class SessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    turnstile_token: str = Field(min_length=1, max_length=2048)


class ScoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    score_token: str = Field(min_length=1, max_length=2048)
    nickname: str = Field(min_length=1, max_length=64)


Language = Literal["te-IN", "hi-IN", "hi-en", "en-IN", "te-en"]


def _register_routes(app: FastAPI) -> None:
    @app.get("/api/healthz")
    async def healthz() -> dict:
        return {"ok": True}

    @app.get("/api/readyz")
    async def readyz(deps: DepsDep) -> JSONResponse:
        checks = {"redis": False, "postgres": False}
        try:
            checks["redis"] = bool(await deps.redis.ping())
        except RedisError:
            pass
        try:
            if deps.leaderboard is not None:
                await deps.leaderboard.ping()
                checks["postgres"] = True
        except Exception:
            log.error("postgres_unavailable")
        ok = all(checks.values())
        return JSONResponse({"ok": ok, **checks}, status_code=200 if ok else 503)

    @app.get("/api/status")
    async def status(request: Request, deps: DepsDep) -> dict:
        _, iph = _ip_hash(request, deps)
        await _limit(deps, "read", iph, deps.settings.rate_read_per_min)
        st = await deps.budget.status()
        return {
            "open": st.open,
            "reason": None
            if st.open
            else ("closed_for_today" if st.reason != "kill_switch" else "maintenance"),
            "languages": [{"code": r.code, "label": r.label} for r in LANGUAGES.values()],
        }

    @app.post("/api/session")
    async def new_session(body: SessionRequest, request: Request, deps: DepsDep) -> dict:
        _require_origin(request, deps)
        _require_small_body(request)
        ip, iph = _ip_hash(request, deps)
        await _limit(deps, "session", iph, deps.settings.rate_session_per_min)
        if not await deps.budget.is_open():
            raise HTTPException(503, "closed_for_today")
        if not await deps.turnstile.verify(body.turnstile_token, ip):
            raise HTTPException(403, "bot_check_failed")
        token, claims = deps.tokens.issue_session(iph)
        log.info("session_issued", ip_hash=iph)
        return {"token": token, "expires_at": claims.expires_at}

    @app.get("/api/packs")
    async def packs(
        request: Request, deps: DepsDep, language: Annotated[Language | None, Query()] = None
    ) -> dict:
        _, iph = _ip_hash(request, deps)
        await _limit(deps, "read", iph, deps.settings.rate_read_per_min)
        return {"packs": [p.summary() for p in deps.packs.list(language)]}

    @app.get("/api/leaderboard")
    async def leaderboard(
        request: Request,
        deps: DepsDep,
        language: Annotated[Language, Query()],
        period: Annotated[Literal["today", "all"], Query()] = "today",
    ) -> dict:
        _, iph = _ip_hash(request, deps)
        await _limit(deps, "read", iph, deps.settings.rate_read_per_min)
        if deps.leaderboard is None:
            raise HTTPException(503, "unavailable")
        rows = await deps.leaderboard.top(language, period=period)
        return {
            "language": language,
            "period": period,
            "entries": [
                {
                    "rank": r.rank,
                    "nickname": r.nickname,
                    "score": r.score,
                    "correct": r.correct,
                    "questions": r.questions,
                    "character": r.character,
                }
                for r in rows
            ],
        }

    @app.post("/api/scores")
    async def submit_score(body: ScoreRequest, request: Request, deps: DepsDep) -> dict:
        _require_origin(request, deps)
        _require_small_body(request)
        _, iph = _ip_hash(request, deps)
        await _limit(deps, "score", iph, deps.settings.rate_score_post_per_min)
        try:
            claims, jti, exp = deps.tokens.verify_score(body.score_token)
        except TokenError:
            raise HTTPException(401, "invalid_score_token") from None
        try:
            nickname = validate_nickname(body.nickname)
        except NicknameError as exc:
            raise HTTPException(422, str(exc)) from None
        if deps.leaderboard is None:
            raise HTTPException(503, "unavailable")
        # Single use: the jti is burned before the insert, so replays fail even if they race.
        if not await deps.redis.set(
            f"maata:jti:{jti}", "1", nx=True, ex=max(exp - int(time.time()), 1) + 60
        ):
            raise HTTPException(409, "already_submitted")
        inserted = await deps.leaderboard.insert(claims, nickname)
        if not inserted:
            raise HTTPException(409, "already_submitted")
        log.info("score_submitted", game_id=claims.game_id, score=claims.score)
        return {"ok": True}

    @app.websocket("/ws/play")
    async def play(ws: WebSocket) -> None:
        await PlaySession(ws, ws.app.state.deps).run()
