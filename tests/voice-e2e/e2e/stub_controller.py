"""The controller's three internal Outreach endpoints (plus voice-config), exactly as voice-service calls them.

- GET  /api/internal/outreach/voice-config
- GET  /api/internal/outreach/calls/{callId}/session
- POST /api/internal/outreach/calls/{callId}/tools/{tool}   {args} -> {ok, say?, end?, redialLanguage?}
- POST /api/internal/outreach/calls/{callId}/events         {type, at, data}

Every request is checked for the service token (claims service=voice, internal, callId matching the path) and logged
with a timestamp. `faults` makes an endpoint answer 503 or answer late. `/__e2e/heard/{callId}` serves the mock STT
the caller's scripted words (no-key mode only).
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import prompt
from .vs import verify_service_token

EVENT_TYPES = ("ringing", "answered", "no_answer", "busy", "voicemail", "transcript", "ended", "error")


@dataclass
class Heard:
    text: str
    start: float  # epoch seconds the utterance's speech starts
    end: float
    taken: bool = False


@dataclass
class Fault:
    """`down`: 503 for these endpoints; `delay_s`: answer late. `until`: epoch seconds the fault lasts to (0 = on)."""

    endpoints: tuple[str, ...]  # session, tools, events, voice-config
    down: bool = False
    delay_s: float = 0.0
    until: float = 0.0

    def active(self, now: float) -> bool:
        return self.until == 0.0 or now < self.until


@dataclass
class StubState:
    secret: str
    sessions: dict[str, dict[str, Any]] = field(default_factory=dict)
    languages: dict[str, str] = field(default_factory=dict)
    log: list[dict[str, Any]] = field(default_factory=list)
    heard: dict[str, list[Heard]] = field(default_factory=dict)
    faults: dict[str, Fault] = field(default_factory=dict)  # callId -> fault
    tool_overrides: dict[str, dict[str, Any]] = field(default_factory=dict)  # callId -> tool -> reply
    auth_failures: int = 0
    placeholder_key: bool = True  # mock brain: satisfy voice-service's Claude check without credentials
    llm_model: str = "claude-haiku-5-5"

    def register(self, call_id: str, session: dict[str, Any]) -> None:
        self.sessions[call_id] = session
        self.languages[call_id] = session.get("language", "en")

    def hear(self, call_id: str, text: str, start: float, end: float) -> None:
        self.heard.setdefault(call_id, []).append(Heard(text, start, end))

    def take_heard(self, call_id: str, at: float) -> str:
        """The utterance playing at `at` (the start of a speech segment), once."""
        for h in self.heard.get(call_id, []):
            if not h.taken and h.start - 0.6 <= at <= h.end + 0.3:
                h.taken = True
                return h.text
        return ""

    def events(self, call_id: str) -> list[dict[str, Any]]:
        return [r for r in self.log if r["callId"] == call_id and r["kind"] == "event" and r["status"] == 200]

    def tools(self, call_id: str) -> list[dict[str, Any]]:
        return [r for r in self.log if r["callId"] == call_id and r["kind"] == "tool"]

    def terminal_events(self, call_id: str) -> list[dict[str, Any]]:
        return [e for e in self.events(call_id) if (e["body"].get("data") or {}).get("terminal")]

    def write_log(self, path: Path) -> None:
        with path.open("w") as f:
            for r in self.log:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")


def create_stub(state: StubState) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    def record(kind: str, call_id: str, req: Request, status: int, body: Any = None, extra: dict[str, Any] | None = None) -> None:
        state.log.append({"t": time.time(), "kind": kind, "callId": call_id, "method": req.method,
                          "path": req.url.path, "status": status, "body": body, **(extra or {})})

    def authed(req: Request, call_id: str | None) -> bool:
        h = req.headers.get("authorization", "")
        token = h[7:].strip() if h[:7].lower() == "bearer " else None
        claims = verify_service_token(token, state.secret)
        ok = bool(claims) and claims.get("service") == "voice" and claims.get("internal") is True
        if ok and call_id is not None:
            ok = claims.get("callId") == call_id
        if not ok:
            state.auth_failures += 1
        return ok

    async def faulted(endpoint: str, call_id: str) -> JSONResponse | None:
        f = state.faults.get(call_id) or state.faults.get("*")
        if f is None or endpoint not in f.endpoints or not f.active(time.time()):
            return None
        if f.delay_s:
            await asyncio.sleep(f.delay_s)
        if f.down:
            return JSONResponse({"error": "e2e fault: controller down"}, status_code=503)
        return None

    @app.get("/api/internal/outreach/voice-config")
    async def voice_config(req: Request) -> JSONResponse:
        if not authed(req, None):
            record("voice-config", "", req, 401)
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        record("voice-config", "", req, 200)
        # The controller's shape (voice-service/tests/fixtures/voice-config.sample.json), without secrets: the Sarvam
        # key stays in voice-service's env and Claude uses federation from its env. With the mock brain, a placeholder
        # key satisfies voice-service's "Claude configured" check; the harness's client factory ignores it.
        body: dict[str, Any] = {"provider": "exotel", "testNumbers": [], "llmModel": state.llm_model,
                                "sarvam": {"voices": {"en": "priya", "hi": "priya", "ta": "kavya"}}}
        if state.placeholder_key:
            body["anthropic"] = {"apiKey": "e2e-mock-placeholder"}
        return JSONResponse(body)

    @app.get("/api/internal/outreach/calls/{call_id}/session")
    async def get_session(call_id: str, req: Request) -> JSONResponse:
        if not authed(req, call_id):
            record("session", call_id, req, 401)
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        bad = await faulted("session", call_id)
        if bad is not None:
            record("session", call_id, req, bad.status_code)
            return bad
        s = state.sessions.get(call_id)
        if s is None:
            record("session", call_id, req, 404)
            return JSONResponse({"error": "unknown call"}, status_code=404)
        record("session", call_id, req, 200)
        return JSONResponse(s)

    @app.post("/api/internal/outreach/calls/{call_id}/tools/{tool}")
    async def call_tool(call_id: str, tool: str, req: Request) -> JSONResponse:
        try:
            body = await req.json()
        except ValueError:
            body = None
        if not authed(req, call_id):
            record("tool", call_id, req, 401, body, {"tool": tool})
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        bad = await faulted("tools", call_id)
        if bad is not None:
            record("tool", call_id, req, bad.status_code, body, {"tool": tool})
            return bad
        args = body.get("args") if isinstance(body, dict) and isinstance(body.get("args"), dict) else None
        if args is None:
            record("tool", call_id, req, 400, body, {"tool": tool})
            return JSONResponse({"ok": False, "error": "args must be an object"}, status_code=400)
        reply = state.tool_overrides.get(call_id, {}).get(tool) or prompt.tool_reply(tool, args, state.languages.get(call_id, "en"))
        record("tool", call_id, req, 200, body, {"tool": tool, "reply": reply})
        return JSONResponse(reply)

    @app.post("/api/internal/outreach/calls/{call_id}/events")
    async def post_event(call_id: str, req: Request) -> JSONResponse:
        try:
            body = await req.json()
        except ValueError:
            body = None
        if not authed(req, call_id):
            record("event", call_id, req, 401, body)
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        bad = await faulted("events", call_id)
        if bad is not None:
            record("event", call_id, req, bad.status_code, body)
            return bad
        valid = (isinstance(body, dict) and body.get("type") in EVENT_TYPES and isinstance(body.get("at"), str)
                 and isinstance(body.get("data"), dict))
        if not valid:
            record("event", call_id, req, 400, body)
            return JSONResponse({"error": "invalid event"}, status_code=400)
        record("event", call_id, req, 200, body)
        return JSONResponse({"ok": True})

    @app.get("/__e2e/heard/{call_id}")
    async def heard(call_id: str, at: float) -> JSONResponse:
        return JSONResponse({"text": state.take_heard(call_id, at)})

    return app
