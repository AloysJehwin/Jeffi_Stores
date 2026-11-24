"""The repo's service-to-service token (packages/service-auth/src/index.ts), in Python.

token = base64url(payload) + '.' + base64url(hmac_sha256(secret, payload)), payload = JSON claims with `exp` (unix s).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000"
SERVICE_NAME = "voice"


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def sign_service_token(claims: dict[str, Any], secret: str, ttl_s: int = 60, now: float | None = None) -> str:
    if not secret:
        raise RuntimeError("SERVICE_AUTH_SECRET is not set")
    payload = json.dumps({**claims, "exp": int(now if now is not None else time.time()) + ttl_s}, separators=(",", ":"))
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()
    return f"{_b64(payload.encode())}.{_b64(sig)}"


def verify_service_token(token: str | None, secret: str, now: float | None = None) -> dict[str, Any] | None:
    if not token or not secret or len(token) > 8192:
        return None
    parts = token.split(".")
    if len(parts) != 2:
        return None
    try:
        payload = _unb64(parts[0])
        given = _unb64(parts[1])
    except (ValueError, TypeError):
        return None
    expected = hmac.new(secret.encode(), payload, hashlib.sha256).digest()
    if not hmac.compare_digest(given, expected):
        return None
    try:
        claims = json.loads(payload)
    except ValueError:
        return None
    if not isinstance(claims, dict) or not isinstance(claims.get("exp"), (int, float)):
        return None
    if claims["exp"] < int(now if now is not None else time.time()):
        return None
    return claims


def bearer(header: str | None) -> str | None:
    if header and header[:7].lower() == "bearer ":
        return header[7:].strip()
    return None


def outbound_token(secret: str, call_id: str | None = None) -> str:
    """voice-service -> controller: the platform tenant, internal."""
    claims: dict[str, Any] = {"service": SERVICE_NAME, "tenantId": PLATFORM_TENANT_ID, "internal": True}
    if call_id:
        claims["callId"] = call_id
    return sign_service_token(claims, secret)


def callback_token(secret: str, call_id: str) -> str:
    """Per-call token in the provider status/stream URLs, so a callback can't be forged for another call."""
    return _b64(hmac.new(secret.encode(), f"voice-callback:{call_id}".encode(), hashlib.sha256).digest()[:18])


def check_callback_token(secret: str, call_id: str, token: str | None) -> bool:
    return bool(token) and hmac.compare_digest(callback_token(secret, call_id), token or "")
