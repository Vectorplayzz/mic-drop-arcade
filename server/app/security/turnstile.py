"""Cloudflare Turnstile server-side verification.

Tokens are single-use and valid for 300 s. We also check the hostname and action in the verdict,
so a token minted on another site that embeds our site key is rejected.
"""

from __future__ import annotations

import secrets

import httpx

from app.logging import get_logger

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
EXPECTED_ACTION = "start"

log = get_logger(__name__)


class TurnstileVerifier:
    def __init__(self, client: httpx.AsyncClient, secret: str, expected_hostname: str) -> None:
        self._client = client
        self._secret = secret
        # One hostname, or several separated by commas (a beta site next to the live one).
        self._hostnames = frozenset(h.strip() for h in expected_hostname.split(",") if h.strip())

    async def verify(self, token: str, remote_ip: str) -> bool:
        if not token or len(token) > 2048:
            return False
        try:
            resp = await self._client.post(
                SITEVERIFY_URL,
                data={
                    "secret": self._secret,
                    "response": token,
                    "remoteip": remote_ip,
                    "idempotency_key": secrets.token_hex(16),
                },
                timeout=5.0,
            )
            resp.raise_for_status()
            verdict = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            # Fail closed: if Cloudflare is unreachable, nobody gets a mic stream.
            log.warning("turnstile_unavailable", error=type(exc).__name__)
            return False
        if not verdict.get("success"):
            log.info("turnstile_rejected", codes=verdict.get("error-codes", []))
            return False
        if self._hostnames and verdict.get("hostname") not in self._hostnames:
            log.warning("turnstile_hostname_mismatch")
            return False
        action = verdict.get("action")
        # Cloudflare test keys return an empty action; with a configured hostname (always the case
        # in production) the widget must have been rendered with action="start".
        if (self._hostnames or action) and action != EXPECTED_ACTION:
            log.warning("turnstile_action_mismatch")
            return False
        return True
