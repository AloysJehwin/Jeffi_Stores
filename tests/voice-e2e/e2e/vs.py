"""voice-service's own auth helpers (imported from its source, not copied), so the harness signs and checks the
same service tokens the real controller does."""

from __future__ import annotations

import sys

from .config import VOICE_SRC

if str(VOICE_SRC) not in sys.path:
    sys.path.insert(0, str(VOICE_SRC))

from voice_service.auth import callback_token, sign_service_token, verify_service_token  # noqa: E402

__all__ = ["callback_token", "sign_service_token", "verify_service_token", "controller_token"]


def controller_token(secret: str) -> str:
    """controller -> voice-service (POST /calls, /hangup)."""
    return sign_service_token({"service": "controller", "tenantId": "00000000-0000-0000-0000-000000000000", "internal": True}, secret)
