from __future__ import annotations

import os
import sys
from dataclasses import replace
from typing import Any

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src"))

from voice_service.calls import StatusUpdate  # noqa: E402
from voice_service.config import Settings  # noqa: E402
from voice_service.controller import Session, ToolResult  # noqa: E402
from voice_service.transports.base import PlaceRequest  # noqa: E402
from voice_service.transports.exotel import ExotelTransport  # noqa: E402

SECRET = "test-service-auth-secret"


@pytest.fixture
def settings(tmp_path: Any) -> Settings:
    return Settings(
        telephony_provider="exotel",
        public_base_url="https://voice.example.test",
        controller_url="http://controller.test",
        service_secret=SECRET,
        max_concurrent_calls=2,
        sarvam_api_key="sarvam-test",
        anthropic_api_key="anthropic-test",
        exotel_sid="exo-sid",
        exotel_api_key="exo-key",
        exotel_api_token="exo-token",
        exotel_app_id="12345",
        exotel_caller_id="+911400000000",
        state_dir=str(tmp_path / "state"),
    )


def twilio_settings(s: Settings, **kw: Any) -> Settings:
    return replace(
        s,
        telephony_provider="twilio",
        twilio_account_sid="AC-test",
        twilio_auth_token="tw-token",
        twilio_voice_from="+15550001111",
        **kw,
    )


def make_session(**kw: Any) -> Session:
    base = {
        "language": "hi",
        "persona": {"name": "Priya", "voiceId": "priya"},
        "systemPrompt": "You are Priya.",
        "greeting": "Namaste! This call may be recorded so we can get your details right.",
        "tools": [],
        "maxDurationS": 600,
        "silenceS": 14,
    }
    base.update(kw)
    return Session.model_validate(base)


class FakeController:
    def __init__(self, session: Session | None = None, session_error: Exception | None = None) -> None:
        self.events: list[tuple[str, str, dict[str, Any]]] = []
        self.session = session or make_session()
        self.session_error = session_error
        self.tool_calls: list[tuple[str, str, dict[str, Any]]] = []

    async def post_event(self, call_id: str, type_: str, data: dict[str, Any] | None = None, **_: Any) -> bool:
        self.events.append((call_id, type_, data or {}))
        return True

    async def get_session(self, call_id: str, **_: Any) -> Session:
        if self.session_error:
            raise self.session_error
        return self.session

    async def call_tool(self, call_id: str, tool: str, args: dict[str, Any], timeout_s: float = 20) -> ToolResult:
        self.tool_calls.append((call_id, tool, args))
        return ToolResult(ok=True)

    def types(self, call_id: str | None = None) -> list[str]:
        return [t for c, t, _ in self.events if call_id is None or c == call_id]


class FakeTransport:
    """Records placements; parses status like Exotel."""

    def __init__(self, name: str = "exotel", fail: Exception | None = None, delay_s: float = 0.0) -> None:
        self.name = name
        self.placed: list[PlaceRequest] = []
        self.hangups: list[str] = []
        self.fail = fail
        self.delay_s = delay_s
        self._exo = ExotelTransport(sid="s", api_key="k", api_token="t", subdomain="x", app_id="1", caller_id="", http=None)  # type: ignore[arg-type]

    async def place_call(self, req: PlaceRequest) -> str:
        import asyncio

        if self.delay_s:
            await asyncio.sleep(self.delay_s)
        if self.fail:
            raise self.fail
        self.placed.append(req)
        return f"PCID-{req.call_id}"

    async def hangup(self, provider_call_id: str) -> None:
        self.hangups.append(provider_call_id)

    def parse_status(self, payload: dict[str, Any]) -> StatusUpdate | None:
        return self._exo.parse_status(payload)

    def serializer(self, stream_id: str, provider_call_id: str) -> Any:
        return None
