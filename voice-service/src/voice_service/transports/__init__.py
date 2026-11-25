"""Telephony transports. Exotel (AgentStream / Voicebot applet) is production; Twilio is for test calls only."""

from __future__ import annotations

import httpx

from ..provider_config import VoiceConfig
from .base import PlaceRequest, Transport, TransportError
from .exotel import ExotelTransport
from .twilio import TwilioTransport

__all__ = ["PlaceRequest", "Transport", "TransportError", "ExotelTransport", "TwilioTransport", "build_transport"]


def build_transport(cfg: VoiceConfig, http: httpx.AsyncClient) -> Transport:
    if cfg.provider == "exotel":
        return ExotelTransport(
            sid=cfg.exotel_sid,
            api_key=cfg.exotel_api_key,
            api_token=cfg.exotel_api_token,
            subdomain=cfg.exotel_subdomain or "api.in.exotel.com",
            app_id=cfg.exotel_app_id,
            caller_id=cfg.exotel_caller_id,
            http=http,
        )
    if cfg.provider == "twilio":
        return TwilioTransport(
            account_sid=cfg.twilio_account_sid, auth_token=cfg.twilio_auth_token, from_=cfg.twilio_from, http=http
        )
    raise TransportError(f"unknown provider {cfg.provider}")
