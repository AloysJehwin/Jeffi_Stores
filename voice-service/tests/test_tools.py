import asyncio
from typing import Any

from voice_service.controller import ControllerError, ToolResult
from voice_service.tools import ToolDispatcher, tool_schemas


class Backend:
    def __init__(self, result: ToolResult | Exception, delay_s: float = 0.0) -> None:
        self.result = result
        self.delay_s = delay_s
        self.calls: list[tuple[str, str, dict[str, Any]]] = []

    async def call_tool(self, call_id: str, tool: str, args: dict[str, Any], timeout_s: float = 20) -> ToolResult:
        self.calls.append((call_id, tool, args))
        await asyncio.sleep(self.delay_s)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class Recorder:
    def __init__(self) -> None:
        self.spoken: list[tuple[str, bool]] = []
        self.ended: list[tuple[str | None, bool]] = []
        self.hooks: list[str] = []

    async def speak(self, text: str, ctx: bool) -> None:
        self.spoken.append((text, ctx))

    async def end(self, redial: str | None, spoke: bool) -> None:
        self.ended.append((redial, spoke))


def dispatcher(backend: Backend, rec: Recorder, filler_after_s: float = 1.8, language: str = "en") -> ToolDispatcher:
    return ToolDispatcher(
        call_id="c1",
        backend=backend,
        speak=rec.speak,
        end_call=rec.end,
        language=language,
        filler_after_s=filler_after_s,
        on_started=lambda: rec.hooks.append("start"),
        on_finished=lambda: rec.hooks.append("finish"),
    )


async def test_say_is_spoken_verbatim_and_llm_not_rerun() -> None:
    rec = Recorder()
    b = Backend(ToolResult(ok=True, say="Your preview is on WhatsApp now."))
    out = await dispatcher(b, rec).dispatch("startPreview", {"business_name": "Sri Ganesh Stores"})
    assert b.calls == [("c1", "startPreview", {"business_name": "Sri Ganesh Stores"})]
    assert rec.spoken == [("Your preview is on WhatsApp now.", True)]
    assert out.run_llm is False and out.result == {"ok": True, "said": "Your preview is on WhatsApp now."}
    assert rec.ended == [] and rec.hooks == ["start", "finish"]


async def test_no_say_lets_the_llm_answer_from_ok() -> None:
    rec = Recorder()
    out = await dispatcher(Backend(ToolResult(ok=True)), rec).dispatch("addDetails", {"hours": "9-9"})
    assert rec.spoken == [] and out.run_llm is True and out.result == {"ok": True}


async def test_filler_plays_when_the_tool_is_slow() -> None:
    rec = Recorder()
    b = Backend(ToolResult(ok=True, say="Done, it's live."), delay_s=0.2)
    out = await dispatcher(b, rec, filler_after_s=0.05, language="hi").dispatch("publishSite", {})
    # The filler is not added to the LLM context; the controller's say is.
    assert rec.spoken[0] == ("एक मिनट।", False)
    assert rec.spoken[1] == ("Done, it's live.", True)
    assert out.result["ok"] is True


async def test_a_filler_hook_speaks_the_filler() -> None:
    rec, fillers = Recorder(), []

    async def filler(text: str) -> None:
        fillers.append(text)

    d = dispatcher(Backend(ToolResult(ok=True, say="Done."), delay_s=0.2), rec, filler_after_s=0.05)
    d.filler = filler
    await d.dispatch("publishSite", {})
    assert fillers == ["One moment."] and rec.spoken == [("Done.", True)]


async def test_no_filler_when_the_tool_is_fast() -> None:
    rec = Recorder()
    await dispatcher(Backend(ToolResult(ok=True), delay_s=0.0), rec, filler_after_s=0.2).dispatch("optOut", {})
    assert rec.spoken == []


async def test_end_hangs_up_after_the_say() -> None:
    rec = Recorder()
    out = await dispatcher(Backend(ToolResult(ok=True, say="Okay, I won't call again.", end=True)), rec).dispatch("optOut", {})
    assert rec.spoken == [("Okay, I won't call again.", True)]
    assert rec.ended == [(None, True)] and out.end and out.run_llm is False


async def test_end_without_say_hangs_up_promptly() -> None:
    rec = Recorder()
    await dispatcher(Backend(ToolResult(ok=True, end=True)), rec).dispatch("markOutcome", {"outcome": "wrong_number"})
    assert rec.ended == [(None, False)]


async def test_redial_language_ends_and_reports_it() -> None:
    rec = Recorder()
    out = await dispatcher(
        Backend(ToolResult(ok=True, say="I'll call you right back in Tamil.", redialLanguage="ta")), rec
    ).dispatch("switchLanguage", {"language": "ta"})
    assert rec.ended == [("ta", True)]
    assert out.redial_language == "ta" and out.run_llm is False


async def test_failure_is_never_success() -> None:
    for result in (ControllerError("tool 502"), ToolResult(ok=False)):
        rec = Recorder()
        out = await dispatcher(Backend(result), rec).dispatch("publishSite", {})
        assert out.result["ok"] is False and "couldn't do that just now" in out.result["error"]
        assert "WhatsApp" not in out.result["error"] and "follow up" not in out.result["error"]
        assert out.run_llm is True and rec.spoken == [] and rec.ended == []


async def test_data_and_error_reach_the_llm() -> None:
    rec = Recorder()
    out = await dispatcher(Backend(ToolResult(ok=True, data={"business": "Ravi Stores", "status": "interested"})), rec).dispatch("getLead", {})
    assert out.result == {"ok": True, "data": {"business": "Ravi Stores", "status": "interested"}}
    assert out.run_llm is True and rec.spoken == []
    out = await dispatcher(Backend(ToolResult(ok=False, error="template_limit")), rec).dispatch("sendLink", {"kind": "preview"})
    assert out.result == {"ok": False, "error": "template_limit"} and out.run_llm is True
    out = await dispatcher(Backend(ToolResult(ok=True, say="Done.", data={"x": 1})), rec).dispatch("markOutcome", {})
    assert out.result == {"ok": True, "said": "Done.", "data": {"x": 1}} and out.run_llm is False


async def test_slow_failure_after_filler() -> None:
    rec = Recorder()
    out = await dispatcher(Backend(ControllerError("timeout"), delay_s=0.1), rec, filler_after_s=0.02).dispatch("x", {})
    assert len(rec.spoken) == 1 and rec.spoken[0][1] is False
    assert out.result["ok"] is False


def test_tool_schemas_accept_the_common_shapes() -> None:
    out = tool_schemas(
        [
            {"name": "optOut", "description": "Stop calls", "input_schema": {"type": "object", "properties": {}}},
            {
                "type": "function",
                "function": {
                    "name": "scheduleCallback",
                    "parameters": {"type": "object", "properties": {"when": {"type": "string"}}, "required": ["when"]},
                },
            },
            {"title": "markOutcome", "type": "object", "properties": {"outcome": {"type": "string"}}},
            {"description": "nameless"},
        ]
    )
    assert [t["name"] for t in out] == ["optOut", "scheduleCallback", "markOutcome"]
    assert out[1]["required"] == ["when"] and out[2]["properties"] == {"outcome": {"type": "string"}}
