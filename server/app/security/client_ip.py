"""Client IP resolution and privacy-preserving hashing.

Forwarded headers are only trusted when the TCP peer is one of our own proxies (nginx on the
host). Anyone hitting the app port directly cannot spoof an address to dodge rate limits.
Raw IPs are never stored: Redis keys and logs use a keyed hash.
"""

from __future__ import annotations

import hashlib
import hmac
from functools import lru_cache
from ipaddress import IPv4Network, IPv6Network, ip_address, ip_network

from starlette.requests import HTTPConnection


@lru_cache(maxsize=8)
def _networks(trusted: tuple[str, ...]) -> tuple[IPv4Network | IPv6Network, ...]:
    return tuple(ip_network(n, strict=False) for n in trusted)


def _is_trusted(peer: str, trusted: tuple[str, ...]) -> bool:
    try:
        addr = ip_address(peer)
    except ValueError:
        return False
    return any(addr in net for net in _networks(trusted))


def resolve_client_ip(conn: HTTPConnection, trusted_proxies: list[str]) -> str:
    peer = conn.client.host if conn.client else ""
    if peer and _is_trusted(peer, tuple(trusted_proxies)):
        # nginx sets X-Real-IP from CF-Connecting-IP after its own real_ip checks.
        forwarded = conn.headers.get("x-real-ip", "").strip()
        if forwarded:
            try:
                return str(ip_address(forwarded))
            except ValueError:
                pass
    return peer or "unknown"


def rate_identity(ip: str) -> str:
    """IPv6 clients control at least a /64 and can rotate addresses inside it freely, so all
    per-IP limits key on the /64. IPv4 stays per address."""
    try:
        addr = ip_address(ip)
    except ValueError:
        return ip
    if addr.version == 6 and addr.ipv4_mapped is None:
        return str(ip_network(f"{addr}/64", strict=False).network_address) + "/64"
    if addr.version == 6 and addr.ipv4_mapped is not None:
        return str(addr.ipv4_mapped)
    return str(addr)


def hash_ip(ip: str, secret: str) -> str:
    ident = rate_identity(ip)
    return hmac.new(secret.encode(), ident.encode(), hashlib.sha256).hexdigest()[:32]
