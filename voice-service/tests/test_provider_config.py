import logging
from dataclasses import replace
from typing import Any

import httpx
import pytest

from voice_service.auth import bearer, verify_service_token
from voice_service.config import Settings
from voice_service.provider_config import ProviderConfigSource, merge

REMOTE = {
    "voice_provider": "exotel",
    "voice_config": {
        "exotel": {"accountSid": "remote-sid", "subdomain": "api.in.exotel.com", "callerId": "+91 140 111 2222", "appId": "999"},
        "twilioTest": {"from": "+15559990000"},
        "testNumbers": ["+919000000001"],
        "sarvam": {"sttModel": "saaras:v3", "ttsModel": "bulbul:v3", "voices": {"hi": "priya", "ta": "kavya", "kn": ""}},
        "llmModel": "claude-haiku-5-5",
    },
    "secrets": {
        "exotel": {"apiKey": "remote-key", "apiToken": "remote-token-SECRET"},
        "sarvam": {"apiKey": "remote-sarvam-SECRET"},
        "anthropic_voice": {"apiKey": "remote-anthropic-SECRET"},
    },
    "configured": {"exotel": True},
}


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def source(settings: Settings, handler: Any, clock: Clock) -> tuple[ProviderConfigSource, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def wrap(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return handler(req)

    return ProviderConfigSource(settings, httpx.AsyncClient(transport=httpx.MockTransport(wrap)), clock=clock), seen


async def test_fetch_and_cache_for_60s(settings: Settings) -> None:
    clock = Clock()
    src, seen = source(settings, lambda r: httpx.Response(200, json=REMOTE), clock)
    cfg = await src.get()
    assert cfg.source == "controller" and cfg.exotel_sid == "remote-sid" and cfg.exotel_api_token == "remote-token-SECRET"
    assert cfg.exotel_caller_id == "+911401112222" and cfg.voice_for("hi-IN") == "priya" and cfg.voice_for("kn") == ""
    req = seen[0]
    assert req.url == "http://controller.test/api/internal/outreach/voice-config"
    assert verify_service_token(bearer(req.headers["authorization"]), settings.service_secret) is not None
    assert req.headers["cache-control"] == "no-store"
    clock.t += 59
    await src.get()
    assert len(seen) == 1
    clock.t += 2
    await src.get()
    assert len(seen) == 2


async def test_unreachable_falls_back_to_env(settings: Settings) -> None:
    def down(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    src, _ = source(settings, down, Clock())
    cfg = await src.get()
    assert cfg.source == "env" and cfg.exotel_sid == "exo-sid" and cfg.sarvam_api_key == "sarvam-test"
    assert cfg.missing() == []


def test_field_by_field_fallback(settings: Settings) -> None:
    partial = {
        "voice_provider": "exotel",
        "voice_config": {"exotel": {"accountSid": "", "appId": "555"}, "testNumbers": ["+919000000001"]},
        "secrets": {"sarvam": {"apiKey": ""}},
    }
    cfg = merge(partial, replace(settings, test_numbers=frozenset({"+919000000002"})))
    assert cfg.exotel_sid == "exo-sid"  # empty remote -> env
    assert cfg.exotel_app_id == "555"  # remote wins
    assert cfg.sarvam_api_key == "sarvam-test"
    assert cfg.test_numbers == frozenset({"+919000000001", "+919000000002"})  # union with TEST_NUMBERS


def test_twilio_test_provider_alias(settings: Settings) -> None:
    cfg = merge({"voice_provider": "twilio_test", "voice_config": {"twilioTest": {"from": "+15550001111"}},
                 "secrets": {"twilio_voice": {"accountSid": "AC1", "authToken": "tok"}}}, settings)
    assert cfg.provider == "twilio" and cfg.twilio_from == "+15550001111" and cfg.missing() == []


async def test_fail_closed_with_no_config_anywhere(tmp_path: Any) -> None:
    bare = Settings(public_base_url="https://v.test", controller_url="http://c.test", service_secret="s",
                    state_dir=str(tmp_path))
    src, _ = source(bare, lambda r: httpx.Response(503), Clock())
    cfg = await src.get()
    assert "exotel.apiKey" in cfg.missing() and "sarvam.apiKey" in cfg.missing() and "anthropic.identity-or-apiKey" in cfg.missing()


async def test_the_response_is_never_logged(settings: Settings, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    src, _ = source(settings, lambda r: httpx.Response(200, json=REMOTE), Clock())
    await src.get()
    src.invalidate()
    src2, _ = source(settings, lambda r: httpx.Response(500, json=REMOTE), Clock())
    await src2.get()
    assert "SECRET" not in caplog.text
