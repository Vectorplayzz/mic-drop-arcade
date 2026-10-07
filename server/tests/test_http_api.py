"""HTTP surface: headers, origin gate, bot check, rate limits, score submission rules."""

from __future__ import annotations

import httpx

from app.config import Settings
from app.main import create_app
from tests.conftest import ORIGIN


async def test_security_headers_and_health(live):
    with live() as server:
        async with httpx.AsyncClient(base_url=server.http) as c:
            r = await c.get("/api/healthz")
            assert r.status_code == 200
            h = r.headers
            assert h["x-content-type-options"] == "nosniff"
            assert h["x-frame-options"] == "DENY"
            assert "default-src 'none'" in h["content-security-policy"]
            assert h["cache-control"] == "no-store"
            assert "server" not in h
            ready = await c.get("/api/readyz")
            assert ready.json() == {"ok": True, "redis": True, "postgres": True}
            assert "access-control-allow-origin" not in r.headers


async def test_session_requires_origin_and_bot_check(live):
    with live() as server:
        async with httpx.AsyncClient(base_url=server.http) as c:
            no_origin = await c.post("/api/session", json={"turnstile_token": "pass"})
            assert no_origin.status_code == 403
            evil = await c.post(
                "/api/session",
                json={"turnstile_token": "pass"},
                headers={"Origin": "https://evil.example"},
            )
            assert evil.status_code == 403
            bot = await c.post(
                "/api/session", json={"turnstile_token": "fail"}, headers={"Origin": ORIGIN}
            )
            assert bot.status_code == 403 and bot.json()["detail"] == "bot_check_failed"
            extra = await c.post(
                "/api/session",
                headers={"Origin": ORIGIN},
                json={"turnstile_token": "pass", "admin": True},
            )
            assert extra.status_code == 422 and "admin" not in extra.text
            big = await c.post(
                "/api/session",
                headers={"Origin": ORIGIN},
                content=b'{"turnstile_token":"' + b"a" * 9000 + b'"}',
            )
            assert big.status_code in (413, 422)


async def test_session_rate_limit(live):
    with live(rate_session_per_min=3) as server:
        async with httpx.AsyncClient(base_url=server.http) as c:
            codes = [
                (
                    await c.post(
                        "/api/session", json={"turnstile_token": "pass"}, headers={"Origin": ORIGIN}
                    )
                ).status_code
                for _ in range(5)
            ]
            assert codes == [200, 200, 200, 429, 429]


async def test_forwarded_ip_ignored_from_untrusted_peer(live):
    # The test client connects from 127.0.0.1; make it untrusted so X-Real-IP is ignored.
    with live(rate_session_per_min=2, trusted_proxies=["10.0.0.0/8"]) as server:
        async with httpx.AsyncClient(base_url=server.http) as c:
            codes = []
            for i in range(3):
                r = await c.post(
                    "/api/session",
                    json={"turnstile_token": "pass"},
                    headers={"Origin": ORIGIN, "X-Real-IP": f"9.9.9.{i}"},
                )
                codes.append(r.status_code)
            assert codes == [200, 200, 429]  # spoofed IPs didn't buy extra requests


async def test_score_submission_rejects_bad_tokens_and_nicknames(live):
    with live() as server:
        async with httpx.AsyncClient(base_url=server.http) as c:
            r = await c.post(
                "/api/scores",
                headers={"Origin": ORIGIN},
                json={"score_token": "abc", "nickname": "Vector"},
            )
            assert r.status_code == 401
            sess = (
                await c.post(
                    "/api/session", json={"turnstile_token": "pass"}, headers={"Origin": ORIGIN}
                )
            ).json()["token"]
            r = await c.post(
                "/api/scores",
                headers={"Origin": ORIGIN},
                json={"score_token": sess, "nickname": "Vector"},
            )
            assert r.status_code == 401  # session token is not a score token
            r = await c.post("/api/scores", json={"score_token": sess, "nickname": "Vector"})
            assert r.status_code == 403


async def test_packs_and_leaderboard_reads(live):
    with live() as server:
        async with httpx.AsyncClient(base_url=server.http) as c:
            packs = (await c.get("/api/packs", params={"language": "hi-IN"})).json()["packs"]
            assert {"hi-test-01"} <= {p["id"] for p in packs}
            bad = await c.get("/api/leaderboard", params={"language": "xx"})
            assert bad.status_code == 422
            empty = (await c.get("/api/leaderboard", params={"language": "te-IN"})).json()
            assert empty["entries"] == []
            st = (await c.get("/api/status")).json()
            assert st["open"] is True and len(st["languages"]) == 5


def test_docs_disabled_in_production():
    s = Settings(
        env="production",
        _env_file=None,
        gnani_api_key="k",
        jwt_secret="a" * 40,
        ip_hash_secret="b" * 40,
        turnstile_secret="real",
        turnstile_hostname="maata.ourspaces.net",
        allowed_origins="https://maata.ourspaces.net",
        public_origin="https://maata.ourspaces.net",
    )
    app = create_app(s)
    assert app.docs_url is None and app.openapi_url is None
