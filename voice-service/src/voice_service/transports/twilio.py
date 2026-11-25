"""Twilio Media Streams: TEST CALLS ONLY.

Twilio can't place compliant promotional calls inside India (foreign caller ID, no 140-series), so it must never
ring a real lead: /calls refuses any number outside the test allowlist (`allowed_test_number`, fail closed).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
from collections.abc import Mapping
from typing import Any
from xml.sax.saxutils import quoteattr

import httpx

from ..calls import CallStatus, StatusUpdate
from ..config import normalize_number
from .base import PlaceRequest, TransportError

API = "https://api.twilio.com/2010-04-01"

STATUS_MAP: dict[str, CallStatus | None] = {
    "queued": None,
    "initiated": None,
    "ringing": CallStatus.RINGING,
    "in-progress": CallStatus.ANSWERED,
    "answered": CallStatus.ANSWERED,
    "completed": CallStatus.COMPLETED,
    "busy": CallStatus.BUSY,
    "no-answer": CallStatus.NO_ANSWER,
    "failed": CallStatus.FAILED,
    "canceled": CallStatus.NO_ANSWER,
}


def map_status(raw: str | None) -> CallStatus | None:
    return STATUS_MAP.get((raw or "").strip().lower())


def allowed_test_number(to: str, allowlist: frozenset[str] | set[str]) -> bool:
    """Fail closed: an empty allowlist allows nothing."""
    n = normalize_number(to)
    return bool(n) and bool(allowlist) and n in allowlist


def twiml(stream_url: str, call_id: str) -> str:
    """<Connect><Stream>: a bidirectional media stream to our WebSocket for the whole call."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response><Connect>"
        f"<Stream url={quoteattr(stream_url)}>"
        f'<Parameter name="callId" value={quoteattr(call_id)}/>'
        "</Stream>"
        "</Connect></Response>"
    )


def signature(auth_token: str, url: str, params: Mapping[str, str]) -> str:
    """X-Twilio-Signature: base64(HMAC-SHA1(token, url + each key+value sorted by key))."""
    data = url + "".join(f"{k}{params[k]}" for k in sorted(params))
    return base64.b64encode(hmac.new(auth_token.encode(), data.encode(), hashlib.sha1).digest()).decode()


def valid_signature(auth_token: str, url: str, params: Mapping[str, str], given: str | None) -> bool:
    return bool(given) and bool(auth_token) and hmac.compare_digest(signature(auth_token, url, params), given or "")


def _int(v: Any) -> int | None:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


class TwilioTransport:
    name = "twilio"

    def __init__(self, *, account_sid: str, auth_token: str, from_: str, http: httpx.AsyncClient) -> None:
        self.account_sid = account_sid
        self.auth_token = auth_token
        self.from_ = from_
        self._http = http

    def calls_form(self, req: PlaceRequest) -> dict[str, str | list[str]]:
        return {
            "To": req.to,
            "From": self.from_,
            "Twiml": twiml(req.stream_url, req.call_id),
            "Timeout": str(req.ring_timeout_s),
            "TimeLimit": str(req.time_limit_s),
            "StatusCallback": req.status_url,
            "StatusCallbackMethod": "POST",
            "StatusCallbackEvent": ["initiated", "ringing", "answered", "completed"],
        }

    async def place_call(self, req: PlaceRequest) -> str:
        url = f"{API}/Accounts/{self.account_sid}/Calls.json"
        try:
            r = await self._http.post(url, data=self.calls_form(req), auth=(self.account_sid, self.auth_token), timeout=15.0)
        except httpx.HTTPError as e:
            raise TransportError(f"twilio unreachable: {type(e).__name__}") from e
        if r.status_code >= 300:
            raise TransportError(f"twilio calls {r.status_code}", r.status_code)
        sid = r.json().get("sid")
        if not isinstance(sid, str) or not sid:
            raise TransportError("twilio calls: no sid")
        return sid

    async def hangup(self, provider_call_id: str) -> None:
        url = f"{API}/Accounts/{self.account_sid}/Calls/{provider_call_id}.json"
        try:
            await self._http.post(url, data={"Status": "completed"}, auth=(self.account_sid, self.auth_token), timeout=10.0)
        except httpx.HTTPError:
            pass

    def parse_status(self, payload: Mapping[str, Any]) -> StatusUpdate | None:
        sid = payload.get("CallSid")
        if not isinstance(sid, str) or not sid:
            return None
        raw = str(payload.get("CallStatus") or "")
        return StatusUpdate(
            provider_call_id=sid, status=map_status(raw), raw_status=raw, duration_s=_int(payload.get("CallDuration"))
        )

    def serializer(self, stream_id: str, provider_call_id: str) -> Any:
        from pipecat.serializers.twilio import TwilioFrameSerializer

        return TwilioFrameSerializer(
            stream_sid=stream_id, call_sid=provider_call_id, account_sid=self.account_sid, auth_token=self.auth_token
        )
