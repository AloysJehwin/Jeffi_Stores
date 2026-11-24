"""The telephone network, simulated: a fake Exotel REST API and a caller speaking Exotel's AgentStream protocol.

voice-service places a call with POST /v1/Accounts/{sid}/Calls/connect.json (the real form). The fake answers with a
Call.Sid, rings, posts the `answered` status callback (JSON, as Exotel does with StatusCallbackContentType), then
opens WS /ws/exotel?k=... like the Voicebot applet:

  -> {"event":"connected"}
  -> {"event":"start", "stream_sid", "start":{stream_sid, call_sid, account_sid, from, to, custom_parameters, media_format}}
  -> {"event":"media", "stream_sid", "media":{"chunk", "timestamp", "payload": base64 8 kHz 16-bit PCM}}  every 20 ms
  <- {"event":"media", "stream_sid", "media":{"payload"}}  the bot's audio
  <- {"event":"clear", "stream_sid"}                        barge-in: drop what is buffered
  -> {"event":"stop", ...} and close                         when the caller hangs up

The bot's audio is played out like a phone speaker: buffered and drained in real time (pipecat sends faster than
real time), and a `clear` discards the unplayed part. When the socket closes, the terminal status callback goes out
(`completed` with ConversationDuration), unless the scenario withholds it.
"""

from __future__ import annotations

import asyncio
import base64
import json
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qsl

import httpx
import websockets
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .audio import FRAME_BYTES, RATE, SPEECH_DBFS, dbfs, frames, speech_bounds

SILENT_FRAME = b"\x00" * FRAME_BYTES
ACCOUNT_SID = "e2e-account"


@dataclass
class Turn:
    """One step of the caller's script.

    kind: say | silence | hangup | drop | beep (pcm given) | audio (pcm given)
    when: bot_done (after the bot's reply has finished, + gap_s) | greeting (after_s into the greeting) |
          barge (after_s into the bot's next reply) | now (after_s)
    """

    text: str = ""
    kind: str = "say"
    when: str = "bot_done"
    after_s: float = 0.0
    gap_s: float = 0.8
    max_wait_s: float = 25.0
    hook: str | None = None
    label: str = ""
    pcm: bytes = b""


@dataclass
class CallPlan:
    call_id: str
    turns: list[Turn]
    answer: str = "answer"  # answer | no-answer | busy
    ring_s: float = 0.8
    max_s: float = 120.0
    post_terminal: bool = True
    end_wait_s: float = 10.0
    hooks: dict[str, Callable[[], Awaitable[Any]]] = field(default_factory=dict)


@dataclass
class Utterance:
    label: str
    text: str
    sent_start: float  # seconds from stream start
    speech_start: float
    speech_end: float
    barge: bool = False


@dataclass
class CallRecord:
    call_id: str
    sid: str = ""
    form: dict[str, str] = field(default_factory=dict)
    placed_at: float = 0.0  # epoch
    answered_at: float = 0.0
    e0: float = 0.0  # epoch at stream start (the `start` message)
    t0: float = 0.0  # monotonic at stream start
    caller: bytearray = field(default_factory=bytearray)
    bot: bytearray = field(default_factory=bytearray)
    utterances: list[Utterance] = field(default_factory=list)
    clears: list[float] = field(default_factory=list)
    clear_dropped_s: list[float] = field(default_factory=list)  # unplayed bot audio each clear discarded
    max_lead_s: float = 0.0  # how far ahead of real time the bot's audio arrived
    bot_onsets: list[float] = field(default_factory=list)
    bot_chunks: int = 0
    bot_bytes: int = 0
    chunk_sizes: set[int] = field(default_factory=set)
    other_events: list[dict[str, Any]] = field(default_factory=list)
    bad_messages: list[str] = field(default_factory=list)
    closed_at: float | None = None  # seconds from stream start
    closed_by: str = ""  # bot | caller | drop | timeout | refused
    close_code: int | None = None
    status_posts: list[dict[str, Any]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    hooks_run: dict[str, float] = field(default_factory=dict)
    done: asyncio.Event = field(default_factory=asyncio.Event)

    def rel(self) -> float:
        return time.monotonic() - self.t0 if self.t0 else 0.0


def start_message(stream_sid: str, call_sid: str, lead: str, exophone: str, seq: int = 1) -> dict[str, Any]:
    """The Voicebot applet's `start` event."""
    return {"event": "start", "sequence_number": seq, "stream_sid": stream_sid, "start": {
        "stream_sid": stream_sid, "call_sid": call_sid, "account_sid": ACCOUNT_SID, "from": lead, "to": exophone,
        "custom_parameters": {}, "media_format": {"encoding": "raw/slin", "sample_rate": "8000", "bit_rate": "128kbps"}}}


def media_message(stream_sid: str, n: int, pcm: bytes, seq: int) -> dict[str, Any]:
    return {"event": "media", "sequence_number": seq, "stream_sid": stream_sid,
            "media": {"chunk": n + 1, "timestamp": str(n * 20), "payload": base64.b64encode(pcm).decode()}}


class _Speaker:
    """The phone's earpiece: the bot's audio on a real-time playback timeline."""

    def __init__(self, rec: CallRecord) -> None:
        self.rec = rec
        self.cursor = 0.0
        self.voiced_until = -10.0

    def play(self, pcm: bytes, now: float) -> None:
        start = max(self.cursor, now)
        dur = len(pcm) / 2 / RATE
        at = int(round(start * RATE)) * 2
        track = self.rec.bot
        if len(track) < at:
            track.extend(b"\x00" * (at - len(track)))
        del track[at:]
        track.extend(pcm)
        self.cursor = start + dur
        self.rec.max_lead_s = max(self.rec.max_lead_s, round(self.cursor - now, 3))
        if dbfs(pcm) > SPEECH_DBFS:
            if start - self.voiced_until > 0.3:
                self.rec.bot_onsets.append(round(start, 3))
            self.voiced_until = max(self.voiced_until, start + dur)

    def clear(self, now: float) -> None:
        self.rec.clears.append(round(now, 3))
        self.rec.clear_dropped_s.append(round(max(0.0, self.cursor - now), 3))
        if self.cursor > now:
            del self.rec.bot[int(round(now * RATE)) * 2 :]
            self.cursor = now
        self.voiced_until = min(self.voiced_until, now)

    def speaking(self, now: float) -> bool:
        return self.voiced_until > now - 0.25


class Caller:
    def __init__(self, plan: CallPlan, rec: CallRecord, ws_url: str, status_url: str,
                 on_utterance: Callable[[str, str, float, float], None]) -> None:
        self.plan, self.rec, self.ws_url, self.status_url = plan, rec, ws_url, status_url
        self.on_utterance = on_utterance
        self.stream_sid = f"stream-{uuid.uuid4().hex[:12]}"
        self.queue: list[bytes] = []
        self.drained = asyncio.Event()
        self.drained.set()
        self.speaker = _Speaker(rec)
        self.ws: Any = None
        self.seq = 0
        self.last_caller_end = 0.0
        self.hanging_up = False

    async def _status(self, payload: dict[str, Any], tries: int = 4) -> None:
        for i in range(tries):
            try:
                async with httpx.AsyncClient(timeout=5.0) as c:
                    r = await c.post(self.status_url, json=payload)
                self.rec.status_posts.append({"at": time.time(), "payload": payload, "status": r.status_code})
                return
            except httpx.HTTPError as e:
                self.rec.status_posts.append({"at": time.time(), "payload": payload, "error": type(e).__name__})
                await asyncio.sleep(1.5 * (i + 1))

    async def _send(self, msg: dict[str, Any]) -> None:
        self.seq += 1
        await self.ws.send(json.dumps({**msg, "sequence_number": self.seq}))

    async def _sender(self) -> None:
        n = 0
        while True:
            target = self.rec.t0 + n * 0.02
            delay = target - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
            frame = self.queue.pop(0) if self.queue else SILENT_FRAME
            if not self.queue:
                self.drained.set()
            self.rec.caller.extend(frame)
            await self._send(media_message(self.stream_sid, n, frame, self.seq + 1))
            n += 1

    async def _receiver(self) -> None:
        async for raw in self.ws:
            now = self.rec.rel()
            try:
                msg = json.loads(raw)
            except (TypeError, ValueError):
                self.rec.bad_messages.append("not json")
                continue
            ev = msg.get("event")
            if msg.get("stream_sid") not in (None, self.stream_sid):
                self.rec.bad_messages.append(f"{ev}: wrong stream_sid")
            if ev == "media":
                try:
                    pcm = base64.b64decode((msg.get("media") or {}).get("payload") or "")
                except ValueError:
                    self.rec.bad_messages.append("media: bad base64")
                    continue
                if len(pcm) % 2:
                    self.rec.bad_messages.append("media: odd byte count")
                self.rec.bot_chunks += 1
                self.rec.bot_bytes += len(pcm)
                self.rec.chunk_sizes.add(len(pcm))
                self.speaker.play(pcm, now)
            elif ev == "clear":
                self.speaker.clear(now)
            else:
                self.rec.other_events.append({"at": round(now, 3), **msg})

    async def _speak(self, turn: Turn, barge: bool = False) -> None:
        pcm = turn.pcm
        if not pcm:
            return
        self.drained.clear()
        start = self.rec.rel() + 0.02
        bounds = speech_bounds(pcm) or (0.0, len(pcm) / 2 / RATE)
        utt = Utterance(turn.label or turn.kind, turn.text, round(start, 3), round(start + bounds[0], 3),
                        round(start + bounds[1], 3), barge)
        self.rec.utterances.append(utt)
        if turn.text:
            self.on_utterance(self.rec.call_id, turn.text, self.rec.e0 + utt.speech_start, self.rec.e0 + utt.speech_end)
        self.queue.extend(frames(pcm))
        await self.drained.wait()
        self.last_caller_end = utt.speech_end

    async def _wait_for(self, turn: Turn) -> bool:
        """Waits for the turn's moment; False when the call ended first."""
        deadline = time.monotonic() + turn.max_wait_s
        if turn.when == "bot_done":
            while time.monotonic() < deadline:
                if self.rec.closed_at is not None:
                    return False
                now = self.rec.rel()
                replied = any(o > self.last_caller_end for o in self.rec.bot_onsets)
                if replied and not self.speaker.speaking(now) and now - self.speaker.voiced_until >= turn.gap_s:
                    break
                await asyncio.sleep(0.05)
            else:
                self.rec.notes.append(f"{turn.label or turn.kind}: no bot reply within {turn.max_wait_s:.0f}s")
        elif turn.when in ("greeting", "barge"):
            while time.monotonic() < deadline:
                if self.rec.closed_at is not None:
                    return False
                if any(o > self.last_caller_end for o in self.rec.bot_onsets) and self.speaker.speaking(self.rec.rel()):
                    break
                await asyncio.sleep(0.02)
            else:
                self.rec.notes.append(f"{turn.label or turn.kind}: the bot never started speaking")
        if turn.after_s:
            await asyncio.sleep(turn.after_s)
        return self.rec.closed_at is None

    async def hangup(self, reason: str = "caller") -> None:
        if self.rec.closed_at is not None or self.hanging_up:
            return
        self.hanging_up = True
        try:
            await self._send({"event": "stop", "stream_sid": self.stream_sid,
                              "stop": {"call_sid": self.rec.sid, "account_sid": ACCOUNT_SID, "reason": "callended"}})
            await self.ws.close()
        except Exception:  # noqa: BLE001
            pass
        if self.rec.closed_at is None:
            self.rec.closed_at, self.rec.closed_by = round(self.rec.rel(), 3), reason

    async def drop(self) -> None:
        self.hanging_up = True
        self.rec.closed_at, self.rec.closed_by = round(self.rec.rel(), 3), "drop"
        try:
            self.ws.transport.abort()
        except Exception:  # noqa: BLE001
            pass

    async def _script(self) -> None:
        for turn in self.plan.turns:
            if not await self._wait_for(turn):
                return
            if turn.hook:
                self.rec.hooks_run[turn.hook] = round(self.rec.rel(), 3)
                await self.plan.hooks[turn.hook]()
            if turn.kind == "hangup":
                await self.hangup()
                return
            if turn.kind == "drop":
                await self.drop()
                return
            if turn.kind in ("say", "beep", "audio"):
                await self._speak(turn, barge=turn.when in ("barge", "greeting"))
        # Script done: give the bot time to finish and hang up itself, else hang up.
        quiet_since = time.monotonic()
        while self.rec.closed_at is None:
            if self.speaker.speaking(self.rec.rel()):
                quiet_since = time.monotonic()
            if time.monotonic() - quiet_since > self.plan.end_wait_s:
                await self.hangup()
                return
            await asyncio.sleep(0.1)

    async def run(self) -> None:
        rec = self.rec
        await asyncio.sleep(self.plan.ring_s)
        if self.plan.answer in ("no-answer", "busy"):
            await self._status({"CallSid": rec.sid, "EventType": "terminal", "Status": self.plan.answer,
                                "ConversationDuration": 0})
            rec.closed_by = self.plan.answer
            return
        rec.answered_at = time.time()
        await self._status({"CallSid": rec.sid, "EventType": "answered", "Status": "in-progress"})
        try:
            self.ws = await websockets.connect(self.ws_url, max_size=None, open_timeout=10)
        except Exception as e:  # noqa: BLE001
            rec.closed_by, rec.notes = "refused", [*rec.notes, f"ws connect failed: {type(e).__name__}"]
            return
        await self.ws.send(json.dumps({"event": "connected"}))
        rec.t0, rec.e0 = time.monotonic(), time.time()
        await self._send(start_message(self.stream_sid, rec.sid, rec.form.get("From", ""), rec.form.get("CallerId", "")))
        sender = asyncio.ensure_future(self._sender())
        receiver = asyncio.ensure_future(self._receiver())
        script = asyncio.ensure_future(self._script())
        try:
            done, _ = await asyncio.wait({receiver, script}, timeout=self.plan.max_s, return_when=asyncio.FIRST_COMPLETED)
            if receiver in done:  # the socket closed
                if rec.closed_at is None:
                    rec.closed_at, rec.closed_by = round(rec.rel(), 3), "bot"
                rec.close_code = getattr(self.ws, "close_code", None)
            elif not done:
                rec.notes.append(f"call ran past {self.plan.max_s:.0f}s")
                await self.hangup("timeout")
            else:
                await asyncio.wait({receiver}, timeout=5)
                rec.close_code = getattr(self.ws, "close_code", None)
        finally:
            for t in (sender, script, receiver):
                t.cancel()
            await asyncio.gather(sender, script, receiver, return_exceptions=True)
        if self.plan.post_terminal:
            duration = int(round(rec.closed_at or rec.rel()))
            await self._status({"CallSid": rec.sid, "EventType": "terminal", "Status": "completed",
                                "ConversationDuration": duration, "Legs": [{"OnCallDuration": duration}]})


class FakeExotel:
    """POST /v1/Accounts/{sid}/Calls/connect.json -> {"Call": {"Sid"}}; then runs the planned caller."""

    def __init__(self, ws_base: str, ws_key: str, on_utterance: Callable[[str, str, float, float], None]) -> None:
        self.ws_base, self.ws_key, self.on_utterance = ws_base, ws_key, on_utterance
        self.plans: dict[str, CallPlan] = {}
        self.records: dict[str, CallRecord] = {}
        self.callers: dict[str, Caller] = {}
        self.tasks: set[asyncio.Task[Any]] = set()
        self.unplanned: list[dict[str, str]] = []
        # For calls placed by a real controller (serve mode): the plan to use for a callId nobody planned.
        self.default_plan: Callable[[str], CallPlan] | None = None

    def plan(self, p: CallPlan) -> CallRecord:
        self.plans[p.call_id] = p
        rec = CallRecord(call_id=p.call_id)
        self.records[p.call_id] = rec
        return rec

    def app(self) -> FastAPI:
        app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

        @app.post("/v1/Accounts/{account}/Calls/connect.json")
        async def connect(account: str, request: Request) -> JSONResponse:
            form = dict(parse_qsl((await request.body()).decode(), keep_blank_values=True))
            call_id = form.get("CustomField", "")
            plan = self.plans.get(call_id)
            if plan is None and self.default_plan is not None and call_id:
                plan = self.default_plan(call_id)
                self.plan(plan)
            if plan is None:
                self.unplanned.append(form)
                return JSONResponse({"RestException": {"Message": "no plan"}}, status_code=400)
            rec = self.records[call_id]
            rec.sid = f"EXO{uuid.uuid4().hex[:20]}"
            rec.form = form
            rec.placed_at = time.time()
            caller = Caller(plan, rec, f"{self.ws_base}/ws/exotel?k={self.ws_key}", form.get("StatusCallback", ""),
                            self.on_utterance)
            self.callers[call_id] = caller

            async def go() -> None:
                try:
                    await caller.run()
                except Exception as e:  # noqa: BLE001
                    rec.notes.append(f"caller crashed: {type(e).__name__}: {e}")
                finally:
                    rec.done.set()

            t = asyncio.ensure_future(go())
            self.tasks.add(t)
            t.add_done_callback(self.tasks.discard)
            return JSONResponse({"Call": {"Sid": rec.sid, "Status": "in-progress", "From": form.get("From"),
                                          "To": form.get("CallerId"), "AccountSid": account}})

        @app.get("/__e2e/calls")
        async def calls() -> JSONResponse:
            return JSONResponse([{"callId": r.call_id, "sid": r.sid, "placedAt": r.placed_at, "answeredAt": r.answered_at,
                                  "closedBy": r.closed_by, "closedAt": r.closed_at, "done": r.done.is_set(),
                                  "said": [u.label for u in r.utterances], "notes": r.notes} for r in self.records.values()])

        return app
