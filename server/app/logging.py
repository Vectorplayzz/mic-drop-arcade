"""Structured JSON logging with a redaction pass.

Logs never carry audio, transcripts, tokens or keys. The redactor is a last line of defence:
call sites should not pass those fields in the first place.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog

_SENSITIVE_KEYS = frozenset(
    {
        "token",
        "score_token",
        "api_key",
        "authorization",
        "x-api-key-id",
        "secret",
        "password",
        "audio",
        "transcript",
        "text",
        "ip",
        "turnstile_token",
        "cookie",
    }
)


def _redact(_: Any, __: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    for key in list(event_dict):
        if key.lower() in _SENSITIVE_KEYS:
            event_dict[key] = "[redacted]"
    return event_dict


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level)
    # Uvicorn's access log prints full request lines; ours is enough and safer.
    logging.getLogger("uvicorn.access").disabled = True
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            _redact,
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(ensure_ascii=False),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level)),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)
