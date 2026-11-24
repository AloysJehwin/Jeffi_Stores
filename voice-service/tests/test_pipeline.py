"""The pipeline's own decisions, with a fake worker: no audio, no network."""

from typing import Any

from conftest import FakeController, make_session

from voice_service import pipeline as pl
from voice_service.calls import Call, Outcome
from voice_service.config import Settings
from voice_service.conversation import Action, TurnState
from voice_service.provider_config import merge
from voice_service.voicemail import VoicemailDetector


class FakeWorker:
    def __init__(self) -> None:
        self.frames: list[Any] = []

    async def queue_frames(self, frames: list[Any]) -> None:
        self.frames.extend(frames)


def runtime(settings: Settings, **session: Any) -> pl.CallRuntime:
    posted: list[tuple[str, dict[str, Any]]] = []

    async def post_event(type_: str, data: dict[str, Any]) -> None:
        posted.append((type_, data))

    rt = pl.CallRuntime(
        call=Call(call_id="c1", to="+91", from_="", language="hi", provider="exotel"),
        session=make_session(**session),
        cfg=merge(None, settings),
        deps=pl.CallDeps(controller=FakeController(), settings=settings, uploader=None, post_event=post_event),  # type: ignore[arg-type]
        turn=TurnState(silence_s=14),
        voicemail=VoicemailDetector(window_s=8),
    )
    rt.worker = FakeWorker()
    rt.posted = posted  # type: ignore[attr-defined]
    return rt


def test_end_request_waits_for_the_closing_words() -> None:
    e = pl.EndRequest(at=10, deadline=25, reason="tool_end", expect_speech_s=4)
    assert not e.done(11, bot_speaking=False, last_bot_stop=0)  # the say hasn't started yet
    e.spoke = True
    assert not e.done(12, bot_speaking=True, last_bot_stop=0)
    assert not e.done(13.5, bot_speaking=False, last_bot_stop=13.0)
    assert e.done(13.9, bot_speaking=False, last_bot_stop=13.0)
    silent = pl.EndRequest(at=10, deadline=25, reason="tool_end", expect_speech_s=0.5)
    assert silent.done(10.6, bot_speaking=False, last_bot_stop=0)  # no say: hang up promptly
    assert pl.EndRequest(at=10, deadline=10, reason="voicemail").done(10, bot_speaking=True, last_bot_stop=0)


async def test_voicemail_ends_immediately_without_a_message(settings: Settings) -> None:
    rt = runtime(settings)
    rt.voicemail.start(0)
    rt.voicemail.on_transcript("Please leave a message after the beep", 2)
    await pl.on_voicemail(rt)
    assert rt.call.outcome == Outcome.VOICEMAIL and rt.end is not None and rt.end.reason == "voicemail"
    assert await pl.tick(rt, rt.end.at) is True
    assert rt.worker.frames == []  # nothing was said


async def test_filler_and_check_in_actions(settings: Settings) -> None:
    from pipecat.frames.frames import LLMMessagesAppendFrame, TTSSpeakFrame

    rt = runtime(settings, language="ta")
    await pl.apply_action(rt, Action.FILLER)
    f = rt.worker.frames[-1]
    assert isinstance(f, TTSSpeakFrame) and f.text == "ஒரு நிமிடம்." and f.append_to_context is False
    await pl.apply_action(rt, Action.CHECK_IN)
    m = rt.worker.frames[-1]
    assert isinstance(m, LLMMessagesAppendFrame) and m.run_llm and m.messages[0]["role"] == "developer"
    await pl.apply_action(rt, Action.GOODBYE)
    assert rt.end is not None and rt.end.reason == "silence"


async def test_failure_apologises_in_language_then_ends(settings: Settings) -> None:
    from pipecat.frames.frames import TTSSpeakFrame

    rt = runtime(settings, language="hi")
    await rt.fail("llm_error")
    f = rt.worker.frames[-1]
    assert isinstance(f, TTSSpeakFrame) and "WhatsApp" in f.text and f.interruptible is False
    assert rt.call.outcome == Outcome.ERROR and rt.call.error_reason == "llm_error" and rt.end is not None
    await rt.fail("again")  # once only
    assert len(rt.worker.frames) == 1


async def test_tts_failure_ends_without_speaking(settings: Settings) -> None:
    rt = runtime(settings)
    await rt.fail("tts_error", can_speak=False)
    assert rt.worker.frames == [] and rt.end is not None and rt.end.deadline == rt.end.at


async def test_max_duration_says_goodbye(settings: Settings) -> None:
    rt = runtime(settings, maxDurationS=60)
    assert await pl.tick(rt, rt.started_at + 59) is False and rt.end is None
    assert await pl.tick(rt, rt.started_at + 61) is False
    assert rt.end is not None and rt.end.reason == "max_duration"


async def test_transcript_batches_go_out_as_events(settings: Settings) -> None:
    import asyncio

    rt = runtime(settings)
    for i in range(6):
        rt.transcript.add("user", f"line {i}")
    await pl.tick(rt, rt.started_at + 1)
    await asyncio.sleep(0)
    assert rt.posted[0][0] == "transcript" and len(rt.posted[0][1]["turns"]) == 6  # type: ignore[attr-defined]


async def test_the_pipeline_wires_up_without_network(settings: Settings) -> None:
    """Builds every Pipecat service, the turn strategies and the worker against the pinned pipecat (nothing connects
    until a StartFrame), so an API drift fails here rather than on a live call."""
    from unittest.mock import MagicMock

    from pipecat.serializers.exotel import ExotelFrameSerializer

    tools = [{"name": "optOut", "description": "Stop calls", "input_schema": {"type": "object", "properties": {}}}]
    rt = runtime(settings, tools=tools)
    rt.worker = None
    built = pl.build_pipeline(MagicMock(), rt, ExotelFrameSerializer(stream_sid="s1", call_sid="c1"))
    assert built.worker is rt.worker and rt.audiobuffer is built.audiobuffer
    assert built.llm.has_function("optOut")


def test_languages_map_to_indian_locales() -> None:
    assert pl.pipecat_language("hi").value == "hi-IN"
    assert pl.pipecat_language("ta-IN").value == "ta-IN"
    assert pl.pipecat_language("fr").value == "en-IN"
