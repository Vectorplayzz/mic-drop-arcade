from __future__ import annotations


class GnaniError(Exception):
    """A Gnani call failed in a way the current round cannot recover from."""

    def __init__(self, message: str, *, retryable: bool = False, status: int | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.status = status


class GnaniAuthError(GnaniError):
    """401/403 — the key is wrong or revoked. Never retried; operators must act."""
