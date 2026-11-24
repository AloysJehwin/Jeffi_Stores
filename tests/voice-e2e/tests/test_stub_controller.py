from __future__ import annotations

import time

from fastapi.testclient import TestClient

from e2e import prompt
from e2e.stub_controller import Fault, StubState, create_stub
from e2e.vs import sign_service_token

SECRET = "stub-test-secret"
CONTACT = {"owner": "Ramesh", "business": "Sri Lakshmi Sweets", "category": "sweet shop", "city": "Madurai"}


def _client() -> tuple[TestClient, StubState]:
    st = StubState(SECRET)
    st.register("c1", prompt.session("c1", "en", CONTACT))
    return TestClient(create_stub(st)), st


def _h(call_id: str | None = "c1", service: str = "voice") -> dict[str, str]:
    claims = {"service": service, "tenantId": "00000000-0000-0000-0000-000000000000", "internal": True}
    if call_id:
        claims["callId"] = call_id
    return {"authorization": f"Bearer {sign_service_token(claims, SECRET)}"}


def test_session_needs_the_voice_token_for_that_call() -> None:
    c, st = _client()
    assert c.get("/api/internal/outreach/calls/c1/session").status_code == 401
    assert c.get("/api/internal/outreach/calls/c1/session", headers=_h("other")).status_code == 401
    assert c.get("/api/internal/outreach/calls/c1/session", headers=_h(service="controller")).status_code == 401
    r = c.get("/api/internal/outreach/calls/c1/session", headers=_h())
    assert r.status_code == 200
    body = r.json()
    assert body["persona"]["name"] == "Priya" and "may be recorded" in body["greeting"]
    assert "ref:c1" in body["systemPrompt"] and {t["name"] for t in body["tools"]} >= {"optOut", "publishSite"}
    assert st.auth_failures == 3


def test_tools_return_scripted_replies_and_are_logged() -> None:
    c, st = _client()
    r = c.post("/api/internal/outreach/calls/c1/tools/optOut", headers=_h(), json={"args": {}})
    assert r.json()["ok"] is True and r.json()["end"] is True and r.json()["say"]
    r = c.post("/api/internal/outreach/calls/c1/tools/switchLanguage", headers=_h(), json={"args": {"language": "ta"}})
    assert r.json()["redialLanguage"] == "ta" and "Tamil" in r.json()["say"]
    assert c.post("/api/internal/outreach/calls/c1/tools/startPreview", headers=_h(), json={"args": "x"}).status_code == 400
    assert [t["tool"] for t in st.tools("c1")] == ["optOut", "switchLanguage", "startPreview"]
    assert all(isinstance(t["t"], float) for t in st.log)


def test_events_validated_and_terminal_counted() -> None:
    c, st = _client()
    ok = {"type": "ended", "at": "2026-11-24T00:00:00.000Z", "data": {"terminal": True}}
    assert c.post("/api/internal/outreach/calls/c1/events", headers=_h(), json=ok).status_code == 200
    assert c.post("/api/internal/outreach/calls/c1/events", headers=_h(), json={"type": "nope", "at": "x", "data": {}}).status_code == 400
    assert len(st.terminal_events("c1")) == 1


def test_faults_down_and_until() -> None:
    c, st = _client()
    st.faults["c1"] = Fault(("tools",), down=True)
    assert c.post("/api/internal/outreach/calls/c1/tools/optOut", headers=_h(), json={"args": {}}).status_code == 503
    st.faults["c1"] = Fault(("tools",), down=True, until=time.time() - 1)
    assert c.post("/api/internal/outreach/calls/c1/tools/optOut", headers=_h(), json={"args": {}}).status_code == 200


def test_voice_config_matches_the_controller_shape_without_secrets() -> None:
    c, st = _client()
    body = c.get("/api/internal/outreach/voice-config", headers=_h(None)).json()
    assert body["provider"] == "exotel" and body["sarvam"]["voices"]["en"] and "apiKey" not in body["sarvam"]
    assert body["anthropic"]["apiKey"] == "e2e-mock-placeholder"  # mock brain only
    st.placeholder_key = False
    assert "anthropic" not in c.get("/api/internal/outreach/voice-config", headers=_h(None)).json()


def test_voice_service_reads_the_stub_config() -> None:
    from voice_service.config import Settings
    from voice_service.provider_config import merge

    c, _ = _client()
    cfg = merge(c.get("/api/internal/outreach/voice-config", headers=_h(None)).json(), Settings(sarvam_api_key="k"))
    assert cfg.provider == "exotel" and cfg.voice_for("ta") == "kavya" and cfg.claude_missing() == []


def test_heard_serves_each_utterance_once() -> None:
    c, st = _client()
    st.hear("c1", "hello there", 100.0, 101.5)
    assert c.get("/__e2e/heard/c1", params={"at": 99.0}).json()["text"] == ""
    assert c.get("/__e2e/heard/c1", params={"at": 100.1}).json()["text"] == "hello there"
    assert c.get("/__e2e/heard/c1", params={"at": 100.1}).json()["text"] == ""
