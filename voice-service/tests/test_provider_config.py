import json
import logging
from pathlib import Path
from dataclasses import replace
from typing import Any

import httpx
import pytest

from voice_service.auth import bearer, verify_service_token
from voice_service.config import Settings
from voice_service.provider_config import AnthropicIdentity, ProviderConfigSource, merge

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "voice-config.sample.json").read_text())
# The controller's getVoiceConfig() shape, trimmed; the full one is FIXTURE.
REMOTE = {
    "provider": "exotel",
    "exotel": {
        "accountSid": "remote-sid", "subdomain": "api.in.exotel.com", "callerId": "+91 140 111 2222", "appId": "999",
        "apiKey": "remote-key", "apiToken": "remote-token-SECRET",
    },
    "twilioTest": {"from": "+15559990000", "accountSid": None, "authToken": None},
    "testNumbers": ["+919000000001"],
    "sarvam": {"sttModel": "saaras:v3", "ttsModel": "bulbul:v3", "voices": {"hi": "priya", "ta": "kavya", "kn": ""},
               "apiKey": "remote-sarvam-SECRET"},
    "llmModel": "claude-haiku-5-5",
    "anthropic": {"apiKey": "remote-anthropic-SECRET", "source": "stored", "federation": False, "configured": True},
    "anthropicIdentity": None,
    "ready": True,
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
        "provider": "exotel",
        "exotel": {"accountSid": "", "appId": "555"},
        "testNumbers": ["+919000000001"],
        "sarvam": {"apiKey": ""},
    }
    cfg = merge(partial, replace(settings, test_numbers=frozenset({"+919000000002"})))
    assert cfg.exotel_sid == "exo-sid"  # empty remote -> env
    assert cfg.exotel_app_id == "555"  # remote wins
    assert cfg.sarvam_api_key == "sarvam-test"
    assert cfg.test_numbers == frozenset({"+919000000001", "+919000000002"})  # union with TEST_NUMBERS
    src = cfg.sources_report()
    assert "exotel.appId" in src["controller"] and "exotel.accountSid" in src["env"] and "sarvam.apiKey" in src["env"]


def test_twilio_test_provider_alias(settings: Settings) -> None:
    cfg = merge({"provider": "twilio_test", "twilioTest": {"from": "+15550001111", "accountSid": "AC1", "authToken": "tok"}}, settings)
    assert cfg.provider == "twilio" and cfg.twilio_from == "+15550001111" and cfg.missing() == []


def test_every_field_of_the_controllers_sample_lands_in_voice_config(tmp_path: Any) -> None:
    bare = Settings(public_base_url="https://v.test", controller_url="http://c.test", service_secret="s", state_dir=str(tmp_path))
    f = FIXTURE
    cfg = merge(f, bare)
    assert cfg.provider == "exotel" and cfg.source == "controller"
    assert (cfg.exotel_sid, cfg.exotel_subdomain, cfg.exotel_caller_id, cfg.exotel_app_id) == (
        f["exotel"]["accountSid"], f["exotel"]["subdomain"], f["exotel"]["callerId"], f["exotel"]["appId"])
    assert (cfg.exotel_api_key, cfg.exotel_api_token) == (f["exotel"]["apiKey"], f["exotel"]["apiToken"])
    assert (cfg.twilio_from, cfg.twilio_account_sid, cfg.twilio_auth_token) == (
        f["twilioTest"]["from"], f["twilioTest"]["accountSid"], f["twilioTest"]["authToken"])
    assert cfg.test_numbers == frozenset(f["testNumbers"])
    assert (cfg.sarvam_api_key, cfg.stt_model, cfg.tts_model) == (f["sarvam"]["apiKey"], f["sarvam"]["sttModel"], f["sarvam"]["ttsModel"])
    assert cfg.voices == f["sarvam"]["voices"] and cfg.voice_for("ta-IN") == "ishita"
    assert cfg.llm_model == f["llmModel"] and cfg.anthropic_api_key == f["anthropic"]["apiKey"]
    i = f["anthropicIdentity"]
    assert cfg.anthropic_identity == AnthropicIdentity(i["organizationId"], i["workspaceId"], i["serviceAccountId"], i["federationRuleId"])
    # every non-secret and secret leaf of the sample is accounted for in `sources`, and none came from env
    assert cfg.sources_report()["env"] == []
    assert set(cfg.sources) >= {
        "provider", "exotel.accountSid", "exotel.subdomain", "exotel.callerId", "exotel.appId", "exotel.apiKey",
        "exotel.apiToken", "twilioTest.from", "twilioTest.accountSid", "twilioTest.authToken", "testNumbers",
        "sarvam.apiKey", "sarvam.sttModel", "sarvam.ttsModel", "sarvam.voices", "llmModel", "anthropic.apiKey",
        "anthropicIdentity.organizationId", "anthropicIdentity.workspaceId", "anthropicIdentity.serviceAccountId",
        "anthropicIdentity.federationRuleId",
    }
    # the sample is exactly the keys merge reads: a new controller field must be added to both, or this fails
    assert set(f) == {"provider", "exotel", "twilioTest", "testNumbers", "sarvam", "llmModel", "anthropic", "anthropicIdentity", "ready"}


def test_sources_report_never_carries_values(settings: Settings) -> None:
    cfg = merge(FIXTURE, settings)
    text = json.dumps(cfg.sources_report())
    assert "fake-" not in text and "SECRET" not in text


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
