"""Claude tool calls -> the controller's tool endpoint.

Rules (plan §2, §8):
- `say` from the controller is spoken verbatim and the LLM is not run again for that turn;
- a filler plays if the controller takes longer than `filler_after_s`;
- `end` hangs up after the speech; `redialLanguage` ends the call too and is reported in the terminal event so the
  controller rings back in that language;
- no false success: when the controller fails or times out, the LLM sees ok=false and is told not to claim success.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from . import phrases
from .controller import ToolResult
from .log import get_logger

log = get_logger("voice.tools")

FAILED_RESULT = {
    "ok": False,
    "error": "Sorry, I couldn't do that just now. Let's continue.",
}


class ToolBackend(Protocol):
    async def call_tool(self, call_id: str, tool: str, args: dict[str, Any], timeout_s: float = ...) -> ToolResult: ...


@dataclass
class ToolOutcome:
    result: dict[str, Any]  # the function result the LLM sees
    say: str | None = None
    end: bool = False
    redial_language: str | None = None
    run_llm: bool = True


Speak = Callable[[str, bool], Awaitable[None]]  # (text, append_to_context)
EndCall = Callable[[str | None, bool], Awaitable[None]]  # (redial_language, a say was queued)
Hook = Callable[[], None]


@dataclass
class ToolDispatcher:
    call_id: str
    backend: ToolBackend
    speak: Speak
    end_call: EndCall
    language: str = "en"
    filler_after_s: float = 1.8
    timeout_s: float = 20.0
    filler_override: list[str] | None = None
    on_started: Hook | None = None
    on_finished: Hook | None = None
    _fillers_played: int = field(default=0, init=False)

    async def dispatch(self, name: str, args: dict[str, Any]) -> ToolOutcome:
        if self.on_started:
            self.on_started()
        try:
            res = await self._call(name, args)
        finally:
            if self.on_finished:
                self.on_finished()
        outcome = to_outcome(res)
        log.info("tool", callId=self.call_id, tool=name, ok=bool(res and res.ok), end=outcome.end,
                 redial=bool(outcome.redial_language))
        if outcome.say:
            await self.speak(outcome.say, True)
        if outcome.end or outcome.redial_language:
            await self.end_call(outcome.redial_language, outcome.say is not None)
        return outcome

    async def _call(self, name: str, args: dict[str, Any]) -> ToolResult | None:
        # Shielded: an interruption that cancels this handler must not abort a controller action half-way.
        task = asyncio.ensure_future(self.backend.call_tool(self.call_id, name, args, timeout_s=self.timeout_s))
        try:
            return await asyncio.wait_for(asyncio.shield(task), self.filler_after_s)
        except TimeoutError:
            pass
        except Exception as e:  # noqa: BLE001
            log.warning("tool failed", callId=self.call_id, tool=name, error=type(e).__name__)
            return None
        await self.speak(phrases.filler(self.language, self._fillers_played, self.filler_override), False)
        self._fillers_played += 1
        try:
            return await asyncio.shield(task)
        except Exception as e:  # noqa: BLE001
            log.warning("tool failed", callId=self.call_id, tool=name, error=type(e).__name__)
            return None


def to_outcome(res: ToolResult | None) -> ToolOutcome:
    if res is None:
        return ToolOutcome(result=dict(FAILED_RESULT), run_llm=True)
    say = (res.say or "").strip() or None
    result: dict[str, Any] = {"ok": bool(res.ok)}
    if say:
        result["said"] = say
    if not res.ok and not say:
        result["error"] = FAILED_RESULT["error"]
    redial = (res.redialLanguage or "").strip() or None
    ends = bool(res.end) or redial is not None
    return ToolOutcome(result=result, say=say, end=bool(res.end), redial_language=redial, run_llm=not say and not ends)


def tool_schemas(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Session tools -> {name, description, properties, required}. Accepts Anthropic (`input_schema`), OpenAI-style
    (`parameters`, or wrapped in `function`) and bare JSON Schema with a `name`/`title`."""
    out = []
    for t in tools:
        if not isinstance(t, dict):
            continue
        fn = t.get("function") if isinstance(t.get("function"), dict) else t
        name = fn.get("name") or fn.get("title")
        if not isinstance(name, str) or not name:
            continue
        schema = fn.get("input_schema") or fn.get("inputSchema") or fn.get("parameters")
        if not isinstance(schema, dict):
            schema = fn if isinstance(fn.get("properties"), dict) else {}
        out.append({
            "name": name,
            "description": str(fn.get("description") or ""),
            "properties": dict(schema.get("properties") or {}),
            "required": [r for r in (schema.get("required") or []) if isinstance(r, str)],
        })
    return out
