"""Exotel: outbound calls into an App Bazaar flow whose Voicebot (AgentStream) applet streams to /ws/exotel.

Flow to build in Exotel (README): [Voicebot applet, URL wss://voice.<root>/ws/exotel?k=<VOICE_WS_KEY>] -> [Hangup].
- Placing: POST /v1/Accounts/{sid}/Calls/connect.json with From = the lead, CallerId = the 140-series ExoPhone,
  Url = the flow (start_voice/{app_id}), TimeOut = ring timeout, TimeLimit = hard cap, and a StatusCallback for the
  `answered` and `terminal` events (JSON).
- Ending: closing the media WebSocket ends the Voicebot applet; the flow's Hangup applet then drops the call. Exotel
  has no REST call to end a live call, so `hangup` is a no-op here and the pipeline closes the socket instead.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import httpx

from ..calls import CallStatus, StatusUpdate
from .base import PlaceRequest, TransportError

STATUS_MAP: dict[str, CallStatus | None] = {
    "queued": None,
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


def _int(v: Any) -> int | None:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


class ExotelTransport:
    name = "exotel"

    def __init__(
        self,
        *,
        sid: str,
        api_key: str,
        api_token: str,
        subdomain: str,
        app_id: str,
        caller_id: str,
        http: httpx.AsyncClient,
    ) -> None:
        self.sid = sid
        self._auth = (api_key, api_token)
        self.subdomain = subdomain
        self.app_id = app_id
        self.caller_id = caller_id
        self._http = http

    @property
    def flow_url(self) -> str:
        return f"http://my.exotel.com/{self.sid}/exoml/start_voice/{self.app_id}"

    def connect_form(self, req: PlaceRequest) -> dict[str, str]:
        return {
            "From": req.to,
            "CallerId": self.caller_id or req.from_,
            "Url": self.flow_url,
            "TimeOut": str(req.ring_timeout_s),
            "TimeLimit": str(req.time_limit_s),
            "CustomField": req.call_id,
            "StatusCallback": req.status_url,
            "StatusCallbackEvents[0]": "answered",
            "StatusCallbackEvents[1]": "terminal",
            "StatusCallbackContentType": "application/json",
        }

    async def place_call(self, req: PlaceRequest) -> str:
        url = f"https://{self.subdomain}/v1/Accounts/{self.sid}/Calls/connect.json"
        try:
            r = await self._http.post(url, data=self.connect_form(req), auth=self._auth, timeout=15.0)
        except httpx.HTTPError as e:
            raise TransportError(f"exotel unreachable: {type(e).__name__}") from e
        if r.status_code >= 300:
            raise TransportError(f"exotel connect {r.status_code}", r.status_code)
        try:
            sid = r.json()["Call"]["Sid"]
        except (ValueError, KeyError, TypeError) as e:
            raise TransportError("exotel connect: no Call.Sid") from e
        if not isinstance(sid, str) or not sid:
            raise TransportError("exotel connect: empty Call.Sid")
        return sid

    async def hangup(self, provider_call_id: str) -> None:
        return None

    def parse_status(self, payload: Mapping[str, Any]) -> StatusUpdate | None:
        sid = payload.get("CallSid")
        if not isinstance(sid, str) or not sid:
            return None
        raw = str(payload.get("Status") or "")
        status = map_status(raw)
        if (payload.get("EventType") or "").lower() == "answered" and status is None:
            status = CallStatus.ANSWERED
        duration = _int(payload.get("ConversationDuration"))
        if duration is None:
            legs = payload.get("Legs")
            if isinstance(legs, list) and legs and isinstance(legs[0], dict):
                duration = _int(legs[0].get("OnCallDuration"))
        return StatusUpdate(provider_call_id=sid, status=status, raw_status=raw, duration_s=duration)

    def serializer(self, stream_id: str, provider_call_id: str) -> Any:
        from pipecat.serializers.exotel import ExotelFrameSerializer

        return ExotelFrameSerializer(stream_sid=stream_id, call_sid=provider_call_id)
