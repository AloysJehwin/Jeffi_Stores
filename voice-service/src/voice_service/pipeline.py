"""One call's Pipecat pipeline:

  telephony WS in -> Sarvam STT (saaras) -> user turn (Silero VAD + Smart Turn) -> Claude -> Sarvam TTS (bulbul)
  -> telephony WS out -> recorder (gated) -> assistant context

Barge-in: the user turn starts on VAD speech after `vad_start_s` and interrupts the bot. End of turn is semantic
(Smart Turn v3) after `turn_silence_s` of silence, waiting up to `turn_max_wait_s` when the model hears an
unfinished sentence. A CallObserver watches the frames for silence, dead air, voicemail, the recording gate and the
transcript; a ticker turns its state into actions.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from . import phrases
from .calls import Call, Outcome
from .controller import ControllerClient, Session, TranscriptBuffer
from .conversation import Action, TurnState
from .llm_client import build_llm_client
from .log import get_logger
from .provider_config import VoiceConfig
from .recording import CallRecorder, RecordingGate, Uploader, store_recording
from .tools import ToolDispatcher, tool_schemas
from .voicemail import Verdict, VoicemailDetector, is_beep

log = get_logger("voice.pipeline")

CONNECTED_NOTE = "[The outbound phone call has connected. You have just greeted the person with the greeting above.]"
CHECK_IN_NOTE = "[The person has been silent for a while. In one short sentence, check whether they are still there.]"
GOODBYE_NOTE = (
    "[The person is still silent. Say a short, polite goodbye in one sentence and mention you'll follow up on "
    "WhatsApp. Do not call any tool.]"
)
TIME_UP_NOTE = "[The call has reached its time limit. Thank them and say a short goodbye in one sentence.]"

SUPPORTED_LANGS = ("en", "hi", "ta", "te", "kn", "ml", "mr", "bn", "gu")


def pipecat_language(code: str) -> Any:
    from pipecat.transcriptions.language import Language

    base = (code or "en").split("-")[0].lower()
    if base not in SUPPORTED_LANGS:
        base = "en"
    return Language(f"{base}-IN")


@dataclass
class EndRequest:
    at: float
    deadline: float
    reason: str
    expect_speech_s: float = 6.0  # how long to wait for queued speech (a say, an LLM goodbye) to start
    spoke: bool = False  # the bot started speaking after the request

    def done(self, now: float, bot_speaking: bool, last_bot_stop: float) -> bool:
        """End now? At the deadline; or once the closing speech has played and 0.8 s of quiet followed; or when
        no speech started within `expect_speech_s`."""
        if now >= self.deadline:
            return True
        if bot_speaking:
            return False
        if self.spoke:
            return now - last_bot_stop >= 0.8
        return now - self.at >= self.expect_speech_s


@dataclass
class CallDeps:
    controller: ControllerClient
    settings: Any  # config.Settings
    uploader: Uploader | None
    post_event: Callable[[str, dict[str, Any]], Awaitable[None]]


@dataclass
class CallRuntime:
    """State shared by the observer, the ticker and the tool dispatcher for one call."""

    call: Call
    session: Session
    cfg: VoiceConfig
    deps: CallDeps
    turn: TurnState
    voicemail: VoicemailDetector
    gate: RecordingGate = field(default_factory=RecordingGate)
    transcript: TranscriptBuffer = field(default_factory=TranscriptBuffer)
    started_at: float = field(default_factory=time.monotonic)
    end: EndRequest | None = None
    last_bot_stop: float = 0.0
    bot_text: list[str] = field(default_factory=list)
    audio_window: bytearray = field(default_factory=bytearray)
    audio_rate: int = 16000
    worker: Any = None
    audiobuffer: Any = None
    failed: bool = False
    fillers: int = 0

    async def queue(self, *frames: Any) -> None:
        if self.worker is not None:
            await self.worker.queue_frames(list(frames))

    async def speak(self, text: str, append_to_context: bool = True, interruptible: bool = True) -> None:
        from pipecat.frames.frames import TTSSpeakFrame

        f = TTSSpeakFrame(text=text, append_to_context=append_to_context)
        if not interruptible:
            f.interruptible = False
        await self.queue(f)

    async def nudge(self, note: str) -> None:
        from pipecat.frames.frames import LLMMessagesAppendFrame

        await self.queue(LLMMessagesAppendFrame(messages=[{"role": "developer", "content": note}], run_llm=True))

    def request_end(self, reason: str, grace_s: float = 12.0, expect_speech_s: float = 6.0) -> None:
        now = time.monotonic()
        if self.end is None:
            self.end = EndRequest(at=now, deadline=now + grace_s, reason=reason, expect_speech_s=expect_speech_s)
            self.turn.ending = True

    async def end_after_speech(self, redial_language: str | None, spoke: bool) -> None:
        if redial_language:
            self.call.redial_language = redial_language
        # With a `say` queued, give it time to start; without one, hang up promptly (no dead air).
        self.request_end("redial" if redial_language else "tool_end", 15.0, 4.0 if spoke else 0.5)

    async def fail(self, reason: str, can_speak: bool = True) -> None:
        """A service broke mid-call: apologise (when TTS still works) and end with an `error` outcome."""
        if self.failed:
            return
        self.failed = True
        self.call.outcome = Outcome.ERROR
        self.call.error_reason = reason
        log.warning("call failing", callId=self.call.call_id, reason=reason)
        if can_speak:
            await self.speak(phrases.apology(self.session.language, self.session.extra("apology")), False, False)
            self.request_end(reason, grace_s=8.0)
        else:
            self.request_end(reason, grace_s=0.0)


class CallObserver:
    """Feeds frames into the runtime's state machines. Built lazily so pipecat is imported only when a call runs."""

    @staticmethod
    def build(rt: CallRuntime) -> Any:
        from pipecat.frames.frames import (
            BotStartedSpeakingFrame,
            BotStoppedSpeakingFrame,
            InputAudioRawFrame,
            TranscriptionFrame,
            TTSTextFrame,
            UserStartedSpeakingFrame,
            UserStoppedSpeakingFrame,
            VADUserStartedSpeakingFrame,
            VADUserStoppedSpeakingFrame,
        )
        from pipecat.observers.base_observer import BaseObserver, FramePushed

        class _Observer(BaseObserver):
            async def on_push_frame(self, data: FramePushed) -> None:
                if not data.first_push:
                    return
                f = data.frame
                now = time.monotonic()
                if isinstance(f, InputAudioRawFrame):
                    on_audio(rt, f.audio, f.sample_rate, now)
                elif isinstance(f, BotStartedSpeakingFrame):
                    if not rt.turn.bot_speaking:
                        rt.turn.on_bot_started(now)
                        rt.gate.on_bot_started()
                        if rt.end is not None:
                            rt.end.spoke = True
                elif isinstance(f, BotStoppedSpeakingFrame):
                    if rt.turn.bot_speaking:
                        rt.turn.on_bot_stopped(now)
                        rt.last_bot_stop = now
                        flush_bot_text(rt)
                        if rt.gate.on_bot_stopped(now) and rt.audiobuffer is not None:
                            await rt.audiobuffer.start_recording()
                elif isinstance(f, VADUserStartedSpeakingFrame):
                    rt.voicemail.on_user_started(now)
                elif isinstance(f, VADUserStoppedSpeakingFrame):
                    rt.voicemail.on_user_stopped(now)
                elif isinstance(f, UserStartedSpeakingFrame):
                    if not rt.turn.user_speaking:
                        rt.turn.on_user_started(now)
                elif isinstance(f, UserStoppedSpeakingFrame):
                    if rt.turn.user_speaking:
                        rt.turn.on_user_stopped(now)
                elif isinstance(f, TranscriptionFrame):
                    rt.transcript.add("user", f.text)
                    log.debug("user said", callId=rt.call.call_id, text=f.text)
                    if rt.voicemail.on_transcript(f.text, now) == Verdict.MACHINE:
                        await on_voicemail(rt)
                elif isinstance(f, TTSTextFrame):
                    rt.bot_text.append(f.text)

        return _Observer()


def flush_bot_text(rt: CallRuntime) -> None:
    if rt.bot_text:
        text = " ".join(t.strip() for t in rt.bot_text if t.strip())
        rt.bot_text.clear()
        rt.transcript.add("agent", text)
        log.debug("agent said", callId=rt.call.call_id, text=text)


def on_audio(rt: CallRuntime, pcm: bytes, sample_rate: int, now: float) -> None:
    """Beep detection over ~150 ms windows, only while the voicemail window is open."""
    if not rt.voicemail.open:
        return
    rt.audio_rate = sample_rate
    rt.audio_window.extend(pcm)
    window_bytes = int(sample_rate * 0.15) * 2
    while len(rt.audio_window) >= window_bytes:
        chunk = np.frombuffer(bytes(rt.audio_window[:window_bytes]), dtype=np.int16)
        del rt.audio_window[:window_bytes]
        rt.voicemail.on_audio(is_beep(chunk, sample_rate), now)


async def on_voicemail(rt: CallRuntime) -> None:
    if rt.call.outcome == Outcome.VOICEMAIL:
        return
    rt.call.outcome = Outcome.VOICEMAIL
    log.info("voicemail detected", callId=rt.call.call_id, reason=rt.voicemail.reason)
    # Leave no message: drop whatever is playing and close now.
    rt.request_end("voicemail", grace_s=0.0)


async def apply_action(rt: CallRuntime, action: Action) -> None:
    lang = rt.session.language
    if action == Action.CHECK_IN:
        await rt.nudge(CHECK_IN_NOTE)
    elif action == Action.GOODBYE:
        await rt.nudge(GOODBYE_NOTE)
        rt.request_end("silence", grace_s=12.0)
    elif action == Action.FILLER:
        await rt.speak(phrases.filler(lang, rt.fillers, rt.session.extra("fillers")), False)
        rt.fillers += 1
    elif action == Action.APOLOGY_END:
        await rt.fail("no_reply")


async def tick(rt: CallRuntime, now: float) -> bool:
    """One ticker step. Returns True when the pipeline should stop now."""
    if rt.voicemail.open and rt.voicemail.tick(now) == Verdict.MACHINE:
        await on_voicemail(rt)
    if rt.end is not None:
        return rt.end.done(now, rt.turn.bot_speaking, rt.last_bot_stop)
    if now - rt.started_at >= max(30, rt.session.maxDurationS):
        await rt.nudge(TIME_UP_NOTE)
        rt.request_end("max_duration", grace_s=12.0)
        return False
    action = rt.turn.tick(now)
    if action is not None:
        await apply_action(rt, action)
    if rt.transcript.due():
        turns = rt.transcript.take()
        asyncio.ensure_future(rt.deps.post_event("transcript", {"turns": turns}))
    return False


@dataclass
class Built:
    worker: Any
    audiobuffer: Any
    recorder: CallRecorder
    llm: Any


def build_pipeline(websocket: Any, rt: CallRuntime, serializer: Any) -> Built:
    """Wires one call's services, pipeline, worker and event handlers (nothing connects until it runs)."""
    from pipecat.adapters.llm.schemas.function_schema import FunctionSchema
    from pipecat.adapters.llm.schemas.tools_schema import ToolsSchema
    from pipecat.audio.turn.smart_turn.base_smart_turn import SmartTurnParams
    from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
    from pipecat.audio.vad.silero import SileroVADAnalyzer
    from pipecat.audio.vad.vad_analyzer import VADParams
    from pipecat.frames.frames import ErrorFrame, FunctionCallResultProperties
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.worker import PipelineParams, PipelineWorker
    from pipecat.processors.aggregators.llm_context import LLMContext
    from pipecat.processors.aggregators.llm_response_universal import (
        LLMContextAggregatorPair,
        LLMUserAggregatorParams,
    )
    from pipecat.processors.audio.audio_buffer_processor import AudioBufferProcessor
    from pipecat.services.anthropic.llm import AnthropicLLMService
    from pipecat.services.llm_service import FunctionCallParams
    from pipecat.services.sarvam.stt import SarvamSTTService
    from pipecat.services.sarvam.tts import SarvamTTSService
    from pipecat.services.stt_service import STTService
    from pipecat.services.tts_service import TTSService
    from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams, FastAPIWebsocketTransport
    from pipecat.turns.user_start.transcription_user_turn_start_strategy import TranscriptionUserTurnStartStrategy
    from pipecat.turns.user_start.vad_user_turn_start_strategy import VADUserTurnStartStrategy
    from pipecat.turns.user_stop.turn_analyzer_user_turn_stop_strategy import TurnAnalyzerUserTurnStopStrategy
    from pipecat.turns.user_turn_strategies import UserTurnStrategies

    s = rt.deps.settings
    cfg = rt.cfg
    session = rt.session
    call = rt.call
    lang = pipecat_language(session.language)

    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True, audio_out_enabled=True, add_wav_header=False, serializer=serializer
        ),
    )
    stt = SarvamSTTService(
        api_key=cfg.sarvam_api_key,
        mode=s.stt_mode,
        settings=SarvamSTTService.Settings(model=cfg.stt_model or s.stt_model, language=lang),
    )
    voice = session.persona.voiceId or cfg.voice_for(session.language)
    tts_settings = SarvamTTSService.Settings(model=cfg.tts_model or s.tts_model, language=lang)
    if voice:
        tts_settings.voice = voice
    tts = SarvamTTSService(api_key=cfg.sarvam_api_key, settings=tts_settings)
    llm = AnthropicLLMService(
        api_key=cfg.anthropic_api_key,
        client=build_llm_client(cfg),
        settings=AnthropicLLMService.Settings(
            model=cfg.llm_model or s.llm_model,
            system_instruction=session.systemPrompt,
            enable_prompt_caching=True,
            max_tokens=s.llm_max_tokens,
            effort=s.llm_effort,
        ),
    )

    schemas = [
        FunctionSchema(name=t["name"], description=t["description"], properties=t["properties"], required=t["required"])
        for t in tool_schemas(session.tools)
    ]
    messages: list[Any] = [{"role": "developer", "content": CONNECTED_NOTE}]
    context = (
        LLMContext(messages=messages, tools=ToolsSchema(standard_tools=schemas)) if schemas else LLMContext(messages)
    )
    vad = SileroVADAnalyzer(params=VADParams(start_secs=s.vad_start_s, stop_secs=s.turn_silence_s))
    smart_turn = LocalSmartTurnAnalyzerV3(params=SmartTurnParams(stop_secs=s.turn_max_wait_s))
    aggregators = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=vad,
            user_turn_strategies=UserTurnStrategies(
                start=[VADUserTurnStartStrategy(), TranscriptionUserTurnStartStrategy()],
                stop=[TurnAnalyzerUserTurnStopStrategy(turn_analyzer=smart_turn)],
            ),
        ),
    )
    recorder = CallRecorder(gate=rt.gate, sample_rate=8000)
    audiobuffer = AudioBufferProcessor(num_channels=1, buffer_size=256 * 1024)
    rt.audiobuffer = audiobuffer

    @audiobuffer.event_handler("on_audio_data")
    async def _on_audio(_buf: Any, audio: bytes, sample_rate: int, num_channels: int) -> None:
        recorder.add(audio, sample_rate, num_channels)

    dispatcher = ToolDispatcher(
        call_id=call.call_id,
        backend=rt.deps.controller,
        speak=lambda text, ctx: rt.speak(text, ctx),
        end_call=rt.end_after_speech,
        language=session.language,
        filler_after_s=s.filler_after_s,
        timeout_s=s.tool_timeout_s,
        filler_override=session.extra("fillers"),
        on_started=lambda: rt.turn.on_tool_started(time.monotonic()),
        on_finished=lambda: rt.turn.on_tool_finished(time.monotonic()),
    )

    async def on_tool(params: FunctionCallParams) -> None:
        outcome = await dispatcher.dispatch(params.function_name, dict(params.arguments or {}))
        await params.result_callback(outcome.result, properties=FunctionCallResultProperties(run_llm=outcome.run_llm))

    llm.register_function(None, on_tool)

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            aggregators.user(),
            llm,
            tts,
            transport.output(),
            audiobuffer,
            aggregators.assistant(),
        ]
    )
    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(audio_in_sample_rate=16000, audio_out_sample_rate=8000, enable_metrics=False),
        observers=[CallObserver.build(rt)],
        idle_timeout_secs=None,
    )
    rt.worker = worker

    @worker.event_handler("on_pipeline_error")
    async def _on_error(_w: Any, frame: ErrorFrame) -> None:
        proc = getattr(frame, "processor", None)
        usable = getattr(proc, "is_usable", True) if proc is not None else True
        fatal = bool(getattr(frame, "fatal", False))
        if usable and not fatal:
            log.warning("recoverable pipeline error", callId=call.call_id, processor=type(proc).__name__)
            return
        kind = "tts" if isinstance(proc, TTSService) else "stt" if isinstance(proc, STTService) else "llm" if proc is llm else "pipeline"
        await rt.fail(f"{kind}_error", can_speak=kind != "tts")

    @transport.event_handler("on_client_connected")
    async def _on_connected(_t: Any, _ws: Any) -> None:
        now = time.monotonic()
        rt.turn.start(now)
        rt.voicemail.start(now)
        await asyncio.sleep(s.greeting_delay_s)
        if rt.end is None:
            # The greeting carries the recording notice: it plays in full (not interruptible) before recording starts.
            rt.gate.queue_notice()
            await rt.speak(session.greeting, True, False)

    @transport.event_handler("on_client_disconnected")
    async def _on_disconnected(_t: Any, _ws: Any) -> None:
        await worker.cancel(reason="remote_hangup")

    return Built(worker=worker, audiobuffer=audiobuffer, recorder=recorder, llm=llm)


async def run_pipeline(websocket: Any, rt: CallRuntime, serializer: Any) -> None:
    """Runs the call until it ends. Sets rt.call.transcript / recording_key; the caller emits the terminal event."""
    from pipecat.workers.runner import WorkerRunner

    built = build_pipeline(websocket, rt, serializer)
    worker, audiobuffer, call, s = built.worker, built.audiobuffer, rt.call, rt.deps.settings

    async def ticker() -> None:
        while not worker.has_finished():
            await asyncio.sleep(0.25)
            try:
                stop = await tick(rt, time.monotonic())
            except Exception:  # noqa: BLE001
                log.exception("ticker failed", callId=call.call_id)
                stop = False
            if stop:
                reason = rt.end.reason if rt.end else "end"
                if rt.end is None or rt.end.deadline <= time.monotonic():
                    await worker.cancel(reason=reason)  # voicemail, hangup, a stuck goodbye: drop now
                else:
                    await worker.end(reason=reason)  # the closing words have played: end cleanly
                return

    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    tick_task = asyncio.ensure_future(ticker())
    try:
        await runner.run()
    finally:
        tick_task.cancel()
        flush_bot_text(rt)
        try:
            await audiobuffer.stop_recording()
        except Exception:  # noqa: BLE001
            pass
        call.transcript = list(rt.transcript.turns)
        call.recording_key = await store_recording(
            built.recorder, call.call_id, s.s3_bucket, s.s3_key_prefix, rt.deps.uploader
        )


async def run_apology_only(websocket: Any, serializer: Any, cfg: VoiceConfig, settings: Any, language: str) -> None:
    """The session couldn't be fetched: say the apology with the default voice and hang up (no dead air)."""
    from pipecat.frames.frames import EndFrame, TTSSpeakFrame
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.workers.runner import WorkerRunner
    from pipecat.pipeline.worker import PipelineParams, PipelineWorker
    from pipecat.services.sarvam.tts import SarvamTTSService
    from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams, FastAPIWebsocketTransport

    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(audio_in_enabled=True, audio_out_enabled=True, serializer=serializer),
    )
    lang = pipecat_language(language)
    tts_settings = SarvamTTSService.Settings(model=cfg.tts_model or settings.tts_model, language=lang)
    if cfg.voice_for(language):
        tts_settings.voice = cfg.voice_for(language)
    tts = SarvamTTSService(api_key=cfg.sarvam_api_key, settings=tts_settings)
    worker = PipelineWorker(
        Pipeline([transport.input(), tts, transport.output()]),
        params=PipelineParams(audio_in_sample_rate=16000, audio_out_sample_rate=8000),
        idle_timeout_secs=None,
    )

    @transport.event_handler("on_client_connected")
    async def _go(_t: Any, _ws: Any) -> None:
        await worker.queue_frames([TTSSpeakFrame(text=phrases.apology(language), append_to_context=False), EndFrame()])

    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    try:
        await asyncio.wait_for(runner.run(), timeout=20)
    except TimeoutError:
        await worker.cancel(reason="apology_timeout")
