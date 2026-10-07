"""Shared WebSocket connect with bounded retries.

Retries only on 429/5xx and network failures, with exponential backoff (0.5 s, 1 s, 2 s ...) as
Gnani's error reference recommends. Auth failures surface immediately.
"""

from __future__ import annotations

import asyncio
import random

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import InvalidHandshake, InvalidStatus

from app.gnani.errors import GnaniAuthError, GnaniError
from app.logging import get_logger

log = get_logger(__name__)

_RETRYABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}


async def open_ws(
    url: str,
    headers: dict[str, str],
    *,
    timeout_s: float,
    retries: int,
    service: str,
    max_size: int = 4 * 1024 * 1024,
) -> ClientConnection:
    attempt = 0
    while True:
        try:
            return await connect(
                url,
                additional_headers=headers,
                open_timeout=timeout_s,
                close_timeout=2.0,
                max_size=max_size,
                ping_interval=20,
                ping_timeout=20,
                compression=None,  # audio does not compress; skip the CPU cost
                user_agent_header="maata-arcade/1.0",
            )
        except InvalidStatus as exc:
            status = exc.response.status_code
            if status in (401, 403):
                log.error("gnani_auth_failed", service=service, status=status)
                raise GnaniAuthError(f"{service} rejected credentials", status=status) from exc
            if status not in _RETRYABLE_STATUS or attempt >= retries:
                raise GnaniError(
                    f"{service} handshake failed",
                    status=status,
                    retryable=status in _RETRYABLE_STATUS,
                ) from exc
            log.warning("gnani_connect_retry", service=service, status=status, attempt=attempt)
        except (OSError, TimeoutError, InvalidHandshake) as exc:
            if attempt >= retries:
                raise GnaniError(f"{service} unreachable", retryable=True) from exc
            log.warning(
                "gnani_connect_retry", service=service, error=type(exc).__name__, attempt=attempt
            )
        delay = min(0.5 * (2**attempt), 4.0) * (0.8 + 0.4 * random.random())  # noqa: S311
        attempt += 1
        await asyncio.sleep(delay)
