"""Client for the controller's internal Outreach endpoints (plan §8)."""

from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

import httpx
from pydantic import BaseModel, ConfigDict, Field

from .auth import outbound_token
from .log import get_logger

log = get_logger("voice.controller")

EVENT_TYPES = ("ringing", "answered", "no_answer", "busy", "voicemail", "transcript", "ended", "error")
TERMINAL_EVENTS = ("no_answer", "busy", "voicemail", "ended", "error")


class Persona(BaseModel):
    model_config = ConfigDict(extra="allow")
    name: str = ""
    voiceId: str = ""


class Session(BaseModel):
    """GET /api/internal/outreach/calls/{callId}/session. Unknown fields are kept (testNumbers, fillers, ...)."""

    model_config = ConfigDict(extra="allow")
    language: str = "en"
    persona: Persona = Field(default_factory=Persona)
    systemPrompt: str
    greeting: str
    tools: list[dict[str, Any]] = Field(default_factory=list)
    maxDurationS: int = 600
    silenceS: float = 14

    def extra(self, key: str, default: Any = None) -> Any:
        return (self.model_extra or {}).get(key, default)


class ToolResult(BaseModel):
    model_config = ConfigDict(extra="allow")
    ok: bool = False
    say: str | None = None
    end: bool = False
    redialLanguage: str | None = None
    data: dict[str, Any] | None = None
    error: str | None = None


class ControllerError(Exception):
    pass


def iso_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class ControllerClient:
    def __init__(self, base_url: str, secret: str, http: httpx.AsyncClient | None = None) -> None:
        self._base = base_url.rstrip("/")
        self._secret = secret
        self._http = http or httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=3.0))

    def _url(self, call_id: str, *rest: str) -> str:
        tail = "/".join(quote(p, safe="") for p in rest)
        return f"{self._base}/api/internal/outreach/calls/{quote(call_id, safe='')}/{tail}"

    def _headers(self, call_id: str) -> dict[str, str]:
        return {"authorization": f"Bearer {outbound_token(self._secret, call_id)}", "content-type": "application/json"}

    async def get_session(self, call_id: str, timeout_s: float = 5.0) -> Session:
        r = await self._http.get(self._url(call_id, "session"), headers=self._headers(call_id), timeout=timeout_s)
        if r.status_code != 200:
            raise ControllerError(f"session {r.status_code}")
        return Session.model_validate(r.json())

    async def call_tool(self, call_id: str, tool: str, args: dict[str, Any], timeout_s: float = 20.0) -> ToolResult:
        r = await self._http.post(
            self._url(call_id, "tools", tool), headers=self._headers(call_id), json={"args": args}, timeout=timeout_s
        )
        if r.status_code >= 500:
            raise ControllerError(f"tool {tool} {r.status_code}")
        try:
            body = r.json()
        except ValueError as e:
            raise ControllerError(f"tool {tool} {r.status_code}: not json") from e
        if r.status_code != 200:
            # A 4xx still carries an LLM-directed reply when the controller has one; never treat it as success.
            res = ToolResult.model_validate(body) if isinstance(body, dict) else ToolResult()
            res.ok = False
            return res
        return ToolResult.model_validate(body)

    async def post_event(
        self,
        call_id: str,
        type_: str,
        data: dict[str, Any] | None = None,
        at: str | None = None,
        attempts: int = 3,
        backoff_s: float = 0.5,
    ) -> bool:
        if type_ not in EVENT_TYPES:
            raise ValueError(f"unknown event type {type_}")
        body = {"type": type_, "at": at or iso_now(), "data": data or {}}
        last = ""
        for i in range(attempts):
            try:
                r = await self._http.post(
                    self._url(call_id, "events"), headers=self._headers(call_id), json=body, timeout=5.0
                )
                if r.status_code < 300:
                    return True
                last = str(r.status_code)
                if 400 <= r.status_code < 500 and r.status_code not in (408, 429):
                    break
            except httpx.HTTPError as e:
                last = type(e).__name__
            if i + 1 < attempts:
                await asyncio.sleep(backoff_s * (2**i))
        log.warning("event not delivered", callId=call_id, type=type_, reason=last)
        return False

    async def aclose(self) -> None:
        await self._http.aclose()


class TranscriptBuffer:
    """Collects turns; flushes `transcript` events in batches. The full list goes out with the terminal event."""

    def __init__(self, batch_size: int = 6, max_age_s: float = 10.0) -> None:
        self.turns: list[dict[str, Any]] = []
        self._pending: list[dict[str, Any]] = []
        self._batch = batch_size
        self._max_age = max_age_s
        self._first_pending_at: float | None = None

    def add(self, role: str, text: str, now: float | None = None) -> None:
        text = text.strip()
        if not text:
            return
        t = now if now is not None else time.time()
        turn = {"role": role, "text": text, "at": datetime.fromtimestamp(t, UTC).isoformat(timespec="milliseconds")}
        self.turns.append(turn)
        self._pending.append(turn)
        if self._first_pending_at is None:
            self._first_pending_at = t

    def due(self, now: float | None = None) -> bool:
        if not self._pending:
            return False
        t = now if now is not None else time.time()
        first = self._first_pending_at if self._first_pending_at is not None else t
        return len(self._pending) >= self._batch or t - first >= self._max_age

    def take(self) -> list[dict[str, Any]]:
        out, self._pending, self._first_pending_at = self._pending, [], None
        return out
