"""In-flight calls: the registry (idempotency, concurrency cap, restart recovery) and the terminal-event rule."""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any


class CallStatus(StrEnum):
    """Provider call states, normalised across transports."""

    RINGING = "ringing"
    ANSWERED = "answered"
    NO_ANSWER = "no_answer"
    BUSY = "busy"
    FAILED = "failed"
    COMPLETED = "completed"


PROVIDER_TERMINAL = (CallStatus.NO_ANSWER, CallStatus.BUSY, CallStatus.FAILED, CallStatus.COMPLETED)


@dataclass
class StatusUpdate:
    provider_call_id: str
    status: CallStatus | None  # None: a state we ignore (queued, initiated)
    raw_status: str
    duration_s: int | None = None


class Outcome(StrEnum):
    ENDED = "ended"
    VOICEMAIL = "voicemail"
    ERROR = "error"


@dataclass
class Call:
    call_id: str
    to: str
    from_: str
    language: str
    provider: str
    created_at: float = field(default_factory=time.time)
    provider_call_id: str | None = None
    ringing_sent: bool = False
    answered_at: float | None = None
    stream_started_at: float | None = None
    stream_ended_at: float | None = None
    pipeline_done: bool = False
    provider_status: CallStatus | None = None
    provider_duration_s: int | None = None
    provider_terminal_at: float | None = None
    outcome: Outcome | None = None
    error_reason: str | None = None
    transcript: list[dict[str, Any]] = field(default_factory=list)
    recording_key: str | None = None
    redial_language: str | None = None
    hangup_requested: bool = False
    terminal_sent: bool = False

    @property
    def answered(self) -> bool:
        return self.answered_at is not None or self.stream_started_at is not None

    def local_duration_s(self) -> int:
        start = self.stream_started_at or self.answered_at
        if start is None:
            return 0
        end = self.stream_ended_at or time.time()
        return max(0, round(end - start))


def terminal_event(call: Call, now: float, grace_s: float = 30.0) -> tuple[str, dict[str, Any]] | None:
    """The one terminal event for a call, once it is decided; None while still waiting.

    The provider's record decides that a call ended. An answered call also waits for its pipeline (transcript and
    recording). If only one of the two arrives, the other is waited for `grace_s`, then the event goes out with what
    is known (`durationSource` says which clock the duration came from).
    """
    if call.terminal_sent:
        return None
    status = call.provider_status
    provider_done = status in PROVIDER_TERMINAL
    if not call.answered:
        if status == CallStatus.NO_ANSWER:
            return "no_answer", {"reason": "no_answer"}
        if status == CallStatus.BUSY:
            return "busy", {"reason": "busy"}
        if status == CallStatus.FAILED:
            return "error", {"reason": "failed"}
        if status == CallStatus.COMPLETED:
            # Completed without an answer callback or a stream: the far end never reached the agent.
            return "no_answer", {"reason": "completed_unanswered"}
        if call.outcome == Outcome.ERROR:
            return "error", {"reason": call.error_reason or "error"}
        return None
    if provider_done and call.pipeline_done:
        source = "provider"
    elif call.pipeline_done and call.stream_ended_at and now - call.stream_ended_at >= grace_s:
        source = "local"
    elif provider_done and call.provider_terminal_at and now - call.provider_terminal_at >= grace_s:
        source = "provider"
    else:
        return None
    duration = call.provider_duration_s if call.provider_duration_s is not None else call.local_duration_s()
    data: dict[str, Any] = {
        "durationS": duration,
        "durationSource": "provider" if call.provider_duration_s is not None else "local",
        "transcript": call.transcript,
        "recordingKey": call.recording_key,
    }
    if source == "local" and not provider_done:
        data["providerStatus"] = "missing"
    outcome = call.outcome or Outcome.ENDED
    if outcome == Outcome.VOICEMAIL:
        return "voicemail", data
    if outcome == Outcome.ERROR:
        return "error", {**data, "reason": call.error_reason or "error"}
    if status == CallStatus.FAILED and not call.stream_started_at:
        return "error", {**data, "reason": "failed"}
    if call.redial_language:
        data["redialLanguage"] = call.redial_language
    return "ended", data


class CapacityError(Exception):
    pass


class CallRegistry:
    """Calls this process placed. `reserve` is synchronous so two concurrent POSTs for one callId can't both place."""

    def __init__(self, max_concurrent: int, state_dir: str | None = None) -> None:
        self.max_concurrent = max_concurrent
        self._calls: dict[str, Call] = {}
        self._by_provider: dict[str, str] = {}
        self._state_file = Path(state_dir) / "inflight.json" if state_dir else None

    def get(self, call_id: str) -> Call | None:
        return self._calls.get(call_id)

    def by_provider_id(self, provider_call_id: str) -> Call | None:
        cid = self._by_provider.get(provider_call_id)
        return self._calls.get(cid) if cid else None

    def active(self) -> list[Call]:
        return [c for c in self._calls.values() if not c.terminal_sent]

    def active_count(self) -> int:
        return len(self.active())

    def reserve(self, call_id: str, to: str, from_: str, language: str, provider: str) -> tuple[Call, bool]:
        """(call, created). An existing callId returns the same call (idempotent); a new one over the cap raises."""
        existing = self._calls.get(call_id)
        if existing is not None:
            return existing, False
        if self.active_count() >= self.max_concurrent:
            raise CapacityError(f"{self.max_concurrent} calls in progress")
        call = Call(call_id=call_id, to=to, from_=from_, language=language, provider=provider)
        self._calls[call_id] = call
        self.persist()
        return call, True

    def bind_provider_id(self, call: Call, provider_call_id: str) -> None:
        call.provider_call_id = provider_call_id
        self._by_provider[provider_call_id] = call.call_id
        self.persist()

    def release_failed_placement(self, call: Call) -> None:
        """Placing failed before the provider took the call: forget it so a retry with the same callId places again."""
        self._calls.pop(call.call_id, None)
        self.persist()

    def mark_terminal(self, call: Call) -> None:
        call.terminal_sent = True
        self.persist()
        # Keep a short tail for idempotent replies; drop old finished calls.
        cutoff = time.time() - 3600
        for cid, c in list(self._calls.items()):
            if c.terminal_sent and c.created_at < cutoff:
                self._calls.pop(cid, None)
                if c.provider_call_id:
                    self._by_provider.pop(c.provider_call_id, None)

    # ── restart recovery ──

    def persist(self) -> None:
        if not self._state_file:
            return
        rows = [{"callId": c.call_id, "providerCallId": c.provider_call_id} for c in self.active()]
        try:
            self._state_file.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._state_file.with_suffix(".tmp")
            tmp.write_text(json.dumps(rows))
            os.replace(tmp, self._state_file)
        except OSError:
            pass

    def take_orphans(self) -> list[dict[str, Any]]:
        """Calls a previous process left in flight (read once at startup, then cleared)."""
        if not self._state_file or not self._state_file.exists():
            return []
        try:
            rows = json.loads(self._state_file.read_text())
        except (OSError, ValueError):
            rows = []
        self.persist()
        return [r for r in rows if isinstance(r, dict) and isinstance(r.get("callId"), str)]
