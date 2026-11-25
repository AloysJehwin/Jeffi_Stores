import json
from typing import Any

import httpx
import pytest

from voice_service.auth import bearer, verify_service_token
from voice_service.controller import ControllerClient, TranscriptBuffer

S = "secret"


def client(handler: Any) -> tuple[ControllerClient, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def wrap(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return handler(req)

    http = httpx.AsyncClient(transport=httpx.MockTransport(wrap))
    return ControllerClient("http://ctl.test/", S, http), seen


def assert_auth(req: httpx.Request, call_id: str) -> None:
    claims = verify_service_token(bearer(req.headers["authorization"]), S)
    assert claims is not None and claims["service"] == "voice" and claims["callId"] == call_id


async def test_session_fetch() -> None:
    body = {
        "language": "ta",
        "persona": {"name": "Priya", "voiceId": "kavya"},
        "systemPrompt": "sp",
        "greeting": "hi",
        "tools": [{"name": "optOut", "input_schema": {"type": "object", "properties": {}}}],
        "maxDurationS": 300,
        "silenceS": 12,
        "testNumbers": ["+911"],
    }
    c, seen = client(lambda r: httpx.Response(200, json=body))
    s = await c.get_session("call 1")
    assert seen[0].method == "GET"
    assert seen[0].url == "http://ctl.test/api/internal/outreach/calls/call%201/session"
    assert_auth(seen[0], "call 1")
    assert s.language == "ta" and s.persona.voiceId == "kavya" and s.maxDurationS == 300
    assert s.extra("testNumbers") == ["+911"]


async def test_tool_call_shape_and_result() -> None:
    c, seen = client(lambda r: httpx.Response(200, json={"ok": True, "say": "Done.", "end": True}))
    res = await c.call_tool("c1", "publishSite", {"x": 1})
    req = seen[0]
    assert req.method == "POST" and req.url.path == "/api/internal/outreach/calls/c1/tools/publishSite"
    assert json.loads(req.content) == {"args": {"x": 1}}
    assert_auth(req, "c1")
    assert res.ok and res.say == "Done." and res.end and res.redialLanguage is None


async def test_tool_4xx_is_never_success() -> None:
    c, _ = client(lambda r: httpx.Response(409, json={"ok": True, "say": "Already done"}))
    res = await c.call_tool("c1", "publishSite", {})
    assert res.ok is False and res.say == "Already done"


async def test_tool_5xx_raises() -> None:
    from voice_service.controller import ControllerError

    c, _ = client(lambda r: httpx.Response(502, text="bad gateway"))
    with pytest.raises(ControllerError):
        await c.call_tool("c1", "optOut", {})


async def test_event_shape_and_retry() -> None:
    codes = iter([500, 200])
    c, seen = client(lambda r: httpx.Response(next(codes)))
    ok = await c.post_event("c1", "ended", {"durationS": 12}, at="2026-11-24T10:00:00Z", backoff_s=0)
    assert ok and len(seen) == 2
    assert seen[0].url.path == "/api/internal/outreach/calls/c1/events"
    assert json.loads(seen[1].content) == {"type": "ended", "at": "2026-11-24T10:00:00Z", "data": {"durationS": 12}}
    assert_auth(seen[1], "c1")


async def test_event_4xx_not_retried_and_unknown_type_rejected() -> None:
    c, seen = client(lambda r: httpx.Response(400))
    assert await c.post_event("c1", "answered", backoff_s=0) is False
    assert len(seen) == 1
    with pytest.raises(ValueError):
        await c.post_event("c1", "made_up")


def test_transcript_batches() -> None:
    b = TranscriptBuffer(batch_size=2, max_age_s=10)
    b.add("agent", "Hello", now=0)
    assert not b.due(now=1)
    b.add("user", "  ", now=1)  # blank is skipped
    assert not b.due(now=1)
    assert b.due(now=11)
    b.add("user", "Hi", now=2)
    assert b.due(now=2)
    assert [t["text"] for t in b.take()] == ["Hello", "Hi"]
    assert not b.due(now=100) and len(b.turns) == 2
