import asyncio
from dataclasses import replace
from typing import Any

import httpx
import pytest
from conftest import FakeController, FakeTransport, make_session, twilio_settings

from voice_service.app import create_app
from voice_service.auth import callback_token, sign_service_token
from voice_service.calls import CallStatus
from voice_service.config import Settings
from voice_service.provider_config import VoiceConfig, merge
from voice_service.service import CallService
from voice_service.transports.base import TransportError


class StaticConfig:
    def __init__(self, cfg: VoiceConfig) -> None:
        self.cfg = cfg

    async def get(self) -> VoiceConfig:
        return self.cfg


def build(settings: Settings, transport: FakeTransport | None = None, controller: FakeController | None = None,
          cfg: VoiceConfig | None = None) -> tuple[CallService, httpx.AsyncClient, FakeTransport, FakeController]:
    t = transport or FakeTransport()
    ctl = controller or FakeController()
    svc = CallService(
        settings,
        ctl,  # type: ignore[arg-type]
        StaticConfig(cfg or merge(None, settings)),  # type: ignore[arg-type]
        http=httpx.AsyncClient(),
        transport_factory=lambda _cfg, _http: t,
    )
    app = create_app(settings, svc, manage=False)
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://voice.test")
    return svc, client, t, ctl


def auth(settings: Settings) -> dict[str, str]:
    tok = sign_service_token({"service": "controller", "tenantId": "00000000-0000-0000-0000-000000000000"}, settings.service_secret)
    return {"authorization": f"Bearer {tok}"}


BODY = {"callId": "call-1", "to": "+919876543210", "from": "+911400000000", "language": "hi"}


async def settle() -> None:
    for _ in range(3):
        await asyncio.sleep(0)


async def test_calls_requires_a_service_token(settings: Settings) -> None:
    _, client, t, _ = build(settings)
    r = await client.post("/calls", json=BODY)
    assert r.status_code == 401
    r = await client.post("/calls", json=BODY, headers={"authorization": "Bearer nope"})
    assert r.status_code == 401 and t.placed == []


async def test_place_call_and_idempotent_duplicate(settings: Settings) -> None:
    svc, client, t, ctl = build(settings)
    r = await client.post("/calls", json=BODY, headers=auth(settings))
    assert r.status_code == 200 and r.json() == {"providerCallId": "PCID-call-1"}
    req = t.placed[0]
    assert req.to == "+919876543210" and req.ring_timeout_s == 35
    assert req.status_url == f"https://voice.example.test/telephony/exotel/status/call-1?t={callback_token(settings.service_secret, 'call-1')}"
    r2 = await client.post("/calls", json=BODY, headers=auth(settings))
    assert r2.status_code == 200 and r2.json()["providerCallId"] == "PCID-call-1" and r2.json()["duplicate"] is True
    assert len(t.placed) == 1
    await settle()
    assert ctl.types("call-1") == ["ringing"]


async def test_concurrent_duplicates_place_once(settings: Settings) -> None:
    _, client, t, _ = build(settings, transport=FakeTransport(delay_s=0.05))
    rs = await asyncio.gather(*[client.post("/calls", json=BODY, headers=auth(settings)) for _ in range(3)])
    assert [r.status_code for r in rs] == [200, 200, 200]
    assert {r.json()["providerCallId"] for r in rs} == {"PCID-call-1"}
    assert len(t.placed) == 1


async def test_concurrency_cap(settings: Settings) -> None:
    _, client, t, _ = build(replace(settings, max_concurrent_calls=2))
    for i in range(2):
        assert (await client.post("/calls", json={**BODY, "callId": f"c{i}"}, headers=auth(settings))).status_code == 200
    r = await client.post("/calls", json={**BODY, "callId": "c3"}, headers=auth(settings))
    assert r.status_code == 429 and len(t.placed) == 2


async def test_failed_placement_frees_the_slot_and_can_retry(settings: Settings) -> None:
    t = FakeTransport(fail=TransportError("exotel connect 500", 500))
    svc, client, _, _ = build(settings, transport=t)
    r = await client.post("/calls", json=BODY, headers=auth(settings))
    assert r.status_code == 502 and svc.registry.active_count() == 0
    t.fail = None
    r = await client.post("/calls", json=BODY, headers=auth(settings))
    assert r.status_code == 200


async def test_refuses_calls_with_no_provider_config(tmp_path: Any) -> None:
    bare = Settings(public_base_url="https://v.test", controller_url="http://c.test", service_secret="s",
                    state_dir=str(tmp_path))
    _, client, t, _ = build(bare)
    r = await client.post("/calls", json=BODY, headers=auth(bare))
    assert r.status_code == 503
    body = r.json()
    assert "Settings -> Providers" in body["error"] and "exotel.apiKey" in body["missing"]
    assert t.placed == []


async def test_twilio_refuses_non_test_numbers(settings: Settings) -> None:
    s = twilio_settings(settings, test_numbers=frozenset({"+919999900000"}))
    _, client, t, _ = build(s, transport=FakeTransport(name="twilio"))
    r = await client.post("/calls", json=BODY, headers=auth(s))
    assert r.status_code == 403 and "test calls only" in r.json()["error"] and t.placed == []
    ok = await client.post("/calls", json={**BODY, "to": "+91 99999 00000"}, headers=auth(s))
    assert ok.status_code == 200 and len(t.placed) == 1


async def test_twilio_with_an_empty_allowlist_fails_closed(settings: Settings) -> None:
    s = twilio_settings(settings)
    _, client, t, _ = build(s, transport=FakeTransport(name="twilio"))
    r = await client.post("/calls", json={**BODY, "to": "+919999900000"}, headers=auth(s))
    assert r.status_code == 403 and t.placed == []


async def test_twilio_allows_the_sessions_test_numbers(settings: Settings) -> None:
    s = twilio_settings(settings)
    ctl = FakeController(session=make_session(testNumbers=["+919999900000"]))
    _, client, t, _ = build(s, transport=FakeTransport(name="twilio"), controller=ctl)
    r = await client.post("/calls", json={**BODY, "to": "+919999900000"}, headers=auth(s))
    assert r.status_code == 200 and len(t.placed) == 1


async def test_status_callbacks_drive_the_events(settings: Settings) -> None:
    svc, client, _, ctl = build(settings)
    await client.post("/calls", json=BODY, headers=auth(settings))
    await settle()
    tok = callback_token(settings.service_secret, "call-1")
    bad = await client.post("/telephony/exotel/status/call-1?t=wrong", json={"CallSid": "PCID-call-1", "Status": "busy"})
    assert bad.status_code == 401
    r = await client.post(f"/telephony/exotel/status/call-1?t={tok}",
                          json={"CallSid": "PCID-call-1", "EventType": "terminal", "Status": "busy"})
    assert r.status_code == 204
    await settle()
    assert ctl.types("call-1") == ["ringing", "busy"]
    assert ctl.events[-1][2]["terminal"] is True and svc.registry.active_count() == 0


async def test_answered_then_completed_waits_for_the_pipeline(settings: Settings) -> None:
    svc, client, _, ctl = build(settings)
    await client.post("/calls", json=BODY, headers=auth(settings))
    await settle()
    tok = callback_token(settings.service_secret, "call-1")
    await client.post(f"/telephony/exotel/status/call-1?t={tok}",
                      json={"CallSid": "PCID-call-1", "EventType": "answered", "Status": "in-progress"})
    await client.post(f"/telephony/exotel/status/call-1?t={tok}",
                      json={"CallSid": "PCID-call-1", "EventType": "terminal", "Status": "completed", "ConversationDuration": "42"})
    await settle()
    assert ctl.types("call-1") == ["ringing", "answered"]  # `ended` waits for the transcript/recording
    call = svc.registry.get("call-1")
    assert call is not None and call.provider_status == CallStatus.COMPLETED
    call.stream_started_at, call.stream_ended_at, call.pipeline_done = 1.0, 43.0, True
    await svc.sweep()
    assert ctl.types("call-1")[-1] == "ended" and ctl.events[-1][2]["durationS"] == 42


async def test_ring_watchdog_reports_no_answer(settings: Settings) -> None:
    svc, client, t, ctl = build(settings)
    await client.post("/calls", json=BODY, headers=auth(settings))
    call = svc.registry.get("call-1")
    assert call is not None
    call.created_at -= settings.ring_timeout_s + 30
    await svc.sweep()
    assert ctl.types("call-1")[-1] == "no_answer" and t.hangups == ["PCID-call-1"]


async def test_restart_reports_inflight_calls_as_error(settings: Settings) -> None:
    svc, client, _, ctl = build(settings)
    await client.post("/calls", json=BODY, headers=auth(settings))
    # Same state dir, new process.
    ctl2 = FakeController()
    svc2 = CallService(settings, ctl2, StaticConfig(merge(None, settings)), http=httpx.AsyncClient())  # type: ignore[arg-type]
    await svc2.start()
    await svc2.stop()
    assert ("call-1", "error", {"reason": "restart", "terminal": True}) in ctl2.events


async def test_shutdown_reports_active_calls_as_error(settings: Settings) -> None:
    svc, client, t, ctl = build(settings)
    await client.post("/calls", json=BODY, headers=auth(settings))
    await svc.stop()
    assert ctl.types("call-1")[-1] == "error" and ctl.events[-1][2]["reason"] == "restart"
    assert t.hangups == ["PCID-call-1"]


async def test_hangup_endpoint(settings: Settings) -> None:
    svc, client, t, _ = build(settings)
    await client.post("/calls", json=BODY, headers=auth(settings))
    r = await client.post("/calls/call-1/hangup", headers=auth(settings))
    assert r.status_code == 200 and svc.registry.get("call-1").hangup_requested  # type: ignore[union-attr]
    assert (await client.post("/calls/nope/hangup", headers=auth(settings))).status_code == 404
    assert (await client.post("/calls/call-1/hangup")).status_code == 401


async def test_healthz(settings: Settings) -> None:
    _, client, _, _ = build(settings)
    r = await client.get("/healthz")
    assert r.status_code == 200 and r.json()["ok"] is True and r.json()["activeCalls"] == 0


@pytest.mark.parametrize("path", ["/ws/exotel", "/ws/twilio/call-1/bad"])
def test_media_sockets_reject_bad_keys(settings: Settings, path: str) -> None:
    from fastapi.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect

    s = replace(settings, ws_key="k1")
    svc = CallService(s, FakeController(), StaticConfig(merge(None, s)), http=httpx.AsyncClient())  # type: ignore[arg-type]
    with TestClient(create_app(s, svc, manage=False)) as tc:
        with pytest.raises(WebSocketDisconnect):
            with tc.websocket_connect(path) as ws:
                ws.receive_text()
