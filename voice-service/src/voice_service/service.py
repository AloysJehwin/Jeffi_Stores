"""Call orchestration: placing calls, provider status callbacks, media sockets, watchdogs and the terminal event."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote

import httpx

from .auth import callback_token
from .calls import Call, CallRegistry, CallStatus, Outcome, StatusUpdate, terminal_event
from .config import Settings, normalize_number
from .controller import ControllerClient, Session
from .log import get_logger, mask_phone
from .provider_config import ProviderConfigSource, VoiceConfig
from .transports import PlaceRequest, Transport, TransportError, build_transport
from .transports.twilio import allowed_test_number

log = get_logger("voice.service")


class ServiceError(Exception):
    status = 500

    def __init__(self, message: str, **detail: Any) -> None:
        super().__init__(message)
        self.detail = detail


class NotConfigured(ServiceError):
    status = 503


class Forbidden(ServiceError):
    status = 403


class AtCapacity(ServiceError):
    status = 429


class PlacementFailed(ServiceError):
    status = 502


class BadRequest(ServiceError):
    status = 400


@dataclass
class Runtime:
    """Per-call objects the registry's plain Call doesn't hold."""

    transport: Transport
    cfg: VoiceConfig
    placed: asyncio.Event = field(default_factory=asyncio.Event)
    session_task: asyncio.Task[Session] | None = None
    pipeline_rt: Any = None  # pipeline.CallRuntime while the media socket is up
    answered_sent: bool = False


TransportFactory = Callable[[VoiceConfig, httpx.AsyncClient], Transport]


class CallService:
    def __init__(
        self,
        settings: Settings,
        controller: ControllerClient,
        provider_config: ProviderConfigSource,
        http: httpx.AsyncClient | None = None,
        transport_factory: TransportFactory = build_transport,
        uploader: Any = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.settings = settings
        self.controller = controller
        self.provider_config = provider_config
        self.http = http or httpx.AsyncClient()
        self.transport_factory = transport_factory
        self.uploader = uploader
        self.clock = clock
        self.registry = CallRegistry(settings.max_concurrent_calls, settings.state_dir)
        self.runtimes: dict[str, Runtime] = {}
        self._watchdog: asyncio.Task[None] | None = None
        self._bg: set[asyncio.Task[Any]] = set()

    # ── lifecycle ──

    async def start(self) -> None:
        """Report calls a previous process left in flight as `error` (it can't resume them), then watch calls."""
        for row in self.registry.take_orphans():
            await self.controller.post_event(row["callId"], "error", {"reason": "restart", "terminal": True})
            log.warning("orphaned call reported", callId=row["callId"])
        self._watchdog = asyncio.ensure_future(self._watch())

    async def stop(self) -> None:
        if self._watchdog:
            self._watchdog.cancel()
        for call in self.registry.active():
            rt = self.runtimes.get(call.call_id)
            if rt and rt.pipeline_rt is not None:
                rt.pipeline_rt.request_end("restart", grace_s=0.0)
            if rt and call.provider_call_id:
                try:
                    await rt.transport.hangup(call.provider_call_id)
                except Exception:  # noqa: BLE001
                    pass
            call.outcome, call.error_reason = Outcome.ERROR, "restart"
            await self._emit(call, "error", {"reason": "restart", "transcript": call.transcript})

    def _spawn(self, coro: Awaitable[Any]) -> None:
        t = asyncio.ensure_future(coro)
        self._bg.add(t)
        t.add_done_callback(self._bg.discard)

    # ── controller -> voice-service ──

    async def place(self, call_id: str, to: str, from_: str, language: str) -> dict[str, Any]:
        if not call_id or not normalize_number(to):
            raise BadRequest("callId and to are required")
        existing = self.registry.get(call_id)
        if existing is not None:
            return await self._existing(existing)
        missing = self.settings.missing_base()
        if missing:
            raise NotConfigured("voice-service is not configured", missing=missing)
        cfg = await self.provider_config.get()
        missing = cfg.missing()
        if missing:
            raise NotConfigured(
                "no provider config: set it in admin Settings -> Providers (or the env fallback)", missing=missing
            )
        to_n = normalize_number(to)
        if cfg.provider == "twilio":
            allow = set(cfg.test_numbers) | await self._session_test_numbers(call_id)
            if not allowed_test_number(to_n, allow):
                log.warning("twilio refused a non-test number", callId=call_id, to=mask_phone(to_n))
                raise Forbidden("twilio is for test calls only: this number is not on the test allowlist")
        try:
            call, created = self.registry.reserve(call_id, to_n, normalize_number(from_), language or "en", cfg.provider)
        except Exception as e:
            raise AtCapacity(str(e)) from e
        if not created:
            return await self._existing(call)
        rt = Runtime(transport=self.transport_factory(cfg, self.http), cfg=cfg)
        self.runtimes[call_id] = rt
        token = callback_token(self.settings.service_secret, call_id)
        base = self.settings.public_base_url
        req = PlaceRequest(
            call_id=call_id,
            to=to_n,
            from_=normalize_number(from_),
            ring_timeout_s=self.settings.ring_timeout_s,
            time_limit_s=self.settings.max_call_ceiling_s,
            status_url=f"{base}/telephony/{cfg.provider}/status/{quote(call_id)}?t={token}",
            stream_url=f"{self.settings.ws_base_url}/ws/twilio/{quote(call_id)}/{token}",
        )
        try:
            pid = await rt.transport.place_call(req)
        except TransportError as e:
            self.registry.release_failed_placement(call)
            self.runtimes.pop(call_id, None)
            rt.placed.set()
            log.warning("placing failed", callId=call_id, provider=cfg.provider, error=str(e))
            raise PlacementFailed(str(e)) from e
        self.registry.bind_provider_id(call, pid)
        rt.placed.set()
        # Fetch the session while it rings, so the greeting isn't held up when they answer.
        rt.session_task = asyncio.ensure_future(self.controller.get_session(call_id))
        rt.session_task.add_done_callback(lambda t: t.cancelled() or t.exception())
        log.info("call placed", callId=call_id, provider=cfg.provider, to=mask_phone(to_n))
        if not call.ringing_sent:
            call.ringing_sent = True
            self._spawn(self.controller.post_event(call_id, "ringing", {"provider": cfg.provider, "providerCallId": pid}))
        return {"providerCallId": pid}

    async def _existing(self, call: Call) -> dict[str, Any]:
        rt = self.runtimes.get(call.call_id)
        if rt is not None and not rt.placed.is_set():
            try:
                await asyncio.wait_for(rt.placed.wait(), 20)
            except TimeoutError:
                pass
        if call.provider_call_id is None:
            raise PlacementFailed("the first request for this callId failed or is still placing")
        return {"providerCallId": call.provider_call_id, "duplicate": True}

    async def _session_test_numbers(self, call_id: str) -> set[str]:
        try:
            session = await self.controller.get_session(call_id)
        except Exception:  # noqa: BLE001
            return set()
        raw = session.extra("testNumbers") or []
        return {normalize_number(n) for n in raw if isinstance(n, str) and normalize_number(n)}

    async def hangup(self, call_id: str) -> dict[str, Any]:
        call = self.registry.get(call_id)
        if call is None:
            return {"ok": False, "reason": "unknown call"}
        call.hangup_requested = True
        rt = self.runtimes.get(call_id)
        if rt and rt.pipeline_rt is not None:
            rt.pipeline_rt.request_end("hangup", grace_s=0.0)
        elif rt and call.provider_call_id:
            await rt.transport.hangup(call.provider_call_id)
        return {"ok": True}

    # ── provider -> voice-service ──

    async def on_status(self, call_id: str, payload: dict[str, Any]) -> None:
        call = self.registry.get(call_id)
        rt = self.runtimes.get(call_id)
        if call is None or rt is None:
            return
        upd = rt.transport.parse_status(payload)
        if upd is None:
            return
        if call.provider_call_id and upd.provider_call_id != call.provider_call_id:
            log.warning("status for another provider call ignored", callId=call_id)
            return
        await self.apply_status(call, upd)

    async def apply_status(self, call: Call, upd: StatusUpdate) -> None:
        now = self.clock()
        log.info("provider status", callId=call.call_id, status=upd.raw_status)
        if upd.status == CallStatus.RINGING and not call.ringing_sent:
            call.ringing_sent = True
            await self.controller.post_event(call.call_id, "ringing", {})
        elif upd.status == CallStatus.ANSWERED:
            await self.mark_answered(call, now)
        elif upd.status is not None and upd.status != CallStatus.RINGING:
            call.provider_status = upd.status
            call.provider_terminal_at = now
            if upd.duration_s is not None:
                call.provider_duration_s = upd.duration_s
            await self.maybe_finish(call)

    async def mark_answered(self, call: Call, now: float) -> None:
        if call.answered_at is None:
            call.answered_at = now
        rt = self.runtimes.get(call.call_id)
        if rt is not None and not rt.answered_sent:
            rt.answered_sent = True
            await self.controller.post_event(call.call_id, "answered", {})

    async def maybe_finish(self, call: Call) -> bool:
        ev = terminal_event(call, self.clock())
        if ev is None:
            return False
        await self._emit(call, *ev)
        return True

    async def _emit(self, call: Call, type_: str, data: dict[str, Any]) -> None:
        if call.terminal_sent:
            return
        self.registry.mark_terminal(call)
        self.runtimes.pop(call.call_id, None)
        log.info("call finished", callId=call.call_id, event=type_, durationS=data.get("durationS"))
        await self.controller.post_event(call.call_id, type_, {**data, "terminal": True}, attempts=5)

    # ── media socket ──

    async def find_streamed_call(self, provider_call_id: str, wait_s: float = 3.0) -> Call | None:
        """The call a media stream belongs to, by the provider's call id (the placement response may still be in
        flight when a fast answer opens the stream)."""
        end = time.monotonic() + wait_s
        while True:
            call = self.registry.by_provider_id(provider_call_id)
            if call is not None or time.monotonic() >= end:
                return call
            await asyncio.sleep(0.1)

    async def run_stream(self, websocket: Any, call: Call, stream_id: str) -> None:
        from . import pipeline as pl
        from .conversation import TurnState
        from .voicemail import VoicemailDetector

        rt = self.runtimes.get(call.call_id)
        if rt is None or call.stream_started_at is not None or call.terminal_sent:
            await websocket.close()
            return
        now = self.clock()
        call.stream_started_at = now
        await self.mark_answered(call, now)
        serializer = rt.transport.serializer(stream_id, call.provider_call_id or "")
        s = self.settings
        try:
            if call.hangup_requested:
                await websocket.close()
                return
            session: Session | None = None
            try:
                task = rt.session_task or asyncio.ensure_future(self.controller.get_session(call.call_id))
                session = await asyncio.wait_for(asyncio.shield(task), 5.0)
            except Exception as e:  # noqa: BLE001
                log.error("session unavailable", callId=call.call_id, error=type(e).__name__)
            if session is None:
                call.outcome, call.error_reason = Outcome.ERROR, "session_unavailable"
                await pl.run_apology_only(websocket, serializer, rt.cfg, s, call.language)
                return
            deps = pl.CallDeps(
                controller=self.controller,
                settings=s,
                uploader=self.uploader,
                post_event=lambda type_, data: self.controller.post_event(call.call_id, type_, data),
            )
            prt = pl.CallRuntime(
                call=call,
                session=session,
                cfg=rt.cfg,
                deps=deps,
                turn=TurnState(silence_s=float(session.silenceS or 14), dead_air_s=s.dead_air_s),
                voicemail=VoicemailDetector(window_s=s.voicemail_window_s),
            )
            rt.pipeline_rt = prt
            await pl.run_pipeline(websocket, prt, serializer)
        except Exception as e:  # noqa: BLE001
            log.exception("pipeline crashed", callId=call.call_id)
            if call.outcome is None:
                call.outcome, call.error_reason = Outcome.ERROR, f"crash:{type(e).__name__}"
        finally:
            rt.pipeline_rt = None
            call.stream_ended_at = self.clock()
            call.pipeline_done = True
            if call.provider_call_id and call.outcome in (Outcome.VOICEMAIL, Outcome.ERROR):
                try:
                    await rt.transport.hangup(call.provider_call_id)
                except Exception:  # noqa: BLE001
                    pass
            await self.maybe_finish(call)

    # ── watchdogs ──

    async def _watch(self) -> None:
        while True:
            await asyncio.sleep(1.0)
            try:
                await self.sweep()
            except Exception:  # noqa: BLE001
                log.exception("watchdog sweep failed")

    async def sweep(self) -> None:
        now = self.clock()
        s = self.settings
        for call in self.registry.active():
            rt = self.runtimes.get(call.call_id)
            if await self.maybe_finish(call):
                continue
            if call.provider_call_id is None:
                continue
            if not call.answered and call.provider_status is None and now - call.created_at > s.ring_timeout_s + 20:
                # The provider never reported back: treat as unanswered and make sure it stops ringing.
                if rt:
                    await rt.transport.hangup(call.provider_call_id)
                call.provider_status, call.provider_terminal_at = CallStatus.NO_ANSWER, now
                await self.maybe_finish(call)
            elif call.answered_at and not call.stream_started_at and now - call.answered_at > 15:
                # Answered but the media stream never connected: nothing can be said on this call.
                if rt:
                    await rt.transport.hangup(call.provider_call_id)
                call.outcome, call.error_reason = Outcome.ERROR, "stream_not_connected"
                call.pipeline_done, call.stream_ended_at = True, now
                await self.maybe_finish(call)
            elif call.stream_started_at and not call.pipeline_done and now - call.stream_started_at > s.max_call_ceiling_s + 60:
                if rt and rt.pipeline_rt is not None:
                    rt.pipeline_rt.request_end("ceiling", grace_s=0.0)
