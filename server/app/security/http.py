"""HTTP hardening: security headers on every response and an Origin gate for state changes.

The API is served same-origin behind nginx, so browsers never need CORS. Requests carrying a
foreign Origin are refused outright; this doubles as CSRF protection for the POST endpoints.
"""

from __future__ import annotations

from starlette.types import ASGIApp, Message, Receive, Scope, Send

API_SECURITY_HEADERS: tuple[tuple[bytes, bytes], ...] = (
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"cross-origin-resource-policy", b"same-origin"),
    (b"cross-origin-opener-policy", b"same-origin"),
    (b"permissions-policy", b"camera=(), geolocation=(), payment=(), usb=()"),
    # The API only ever returns JSON; nothing it serves should execute or embed.
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
    (b"cache-control", b"no-store"),
)
HSTS = (b"strict-transport-security", b"max-age=63072000; includeSubDomains; preload")


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp, *, hsts: bool) -> None:
        self.app = app
        self.hsts = hsts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [
                    (k, v)
                    for k, v in message.get("headers", [])
                    if k.lower() not in {b"server", b"x-powered-by"}
                ]
                present = {k.lower() for k, _ in headers}
                for k, v in API_SECURITY_HEADERS:
                    if k not in present:
                        headers.append((k, v))
                if self.hsts:
                    headers.append(HSTS)
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_wrapper)


def origin_allowed(origin: str | None, allowed: list[str]) -> bool:
    """Exact match only; no wildcards, no suffix matching."""
    return bool(origin) and origin in allowed
