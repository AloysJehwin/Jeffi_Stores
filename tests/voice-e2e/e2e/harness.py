"""Runs voice-service for real against a stub controller, a fake Exotel and simulated callers, and collects what
happened on each call."""

from __future__ import annotations

import asyncio
import os
import secrets
import signal
import socket
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import uvicorn

from . import audio, metrics, prompt
from .config import CACHE_DIR, HARNESS_DIR, SHADOWING_VARS, VOICE_SRC, WIF_VARS, Keys
from .mock_llm import MockState, create_mock_llm
from .phone import CallPlan, CallRecord, FakeExotel, Turn
from .stub_controller import Fault, StubState, create_stub
from .vs import controller_token

LEAD = "+919000000001"
EXOPHONE = "+911400000000"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@dataclass
class Providers:
    stt: str = "mock"
    tts: str = "mock"
    llm: str = "mock"

    @property
    def any_real(self) -> bool:
        return "real" in (self.stt, self.tts, self.llm)

    def label(self) -> str:
        return f"STT {self.stt}, TTS {self.tts}, LLM {self.llm}"


@dataclass
class CallResult:
    call_id: str
    rec: CallRecord
    place_status: int = 0
    place_body: dict[str, Any] = field(default_factory=dict)
    events: list[dict[str, Any]] = field(default_factory=list)
    terminal: list[dict[str, Any]] = field(default_factory=list)
    tools: list[dict[str, Any]] = field(default_factory=list)
    transcript: list[dict[str, Any]] = field(default_factory=list)
    llm: dict[str, Any] = field(default_factory=dict)
    metrics: dict[str, Any] = field(default_factory=dict)
    files: list[str] = field(default_factory=list)
    marks: dict[str, float] = field(default_factory=dict)  # seconds from stream start

    def agent_text(self) -> str:
        return metrics.agent_text(self.transcript)

    def agent_turns_after(self, t_rel: float) -> list[str]:
        e0 = self.rec.e0
        out = []
        for turn in self.transcript:
            if turn.get("role") != "agent":
                continue
            try:
                from datetime import datetime

                at = datetime.fromisoformat(str(turn.get("at")).replace("Z", "+00:00")).timestamp() - e0
            except ValueError:
                at = 0.0
            if at >= t_rel:
                out.append(str(turn.get("text", "")))
        return out

    def tool_names(self) -> list[str]:
        return [t["tool"] for t in self.tools if t.get("status") == 200]


class Harness:
    def __init__(self, out: Path, providers: Providers, keys: Keys, max_concurrent: int = 5,
                 controller_url: str = "", secret: str = "", voice_port: int = 0) -> None:
        self.out, self.providers, self.keys = out, providers, keys
        # serve mode (the outreach flow test): a real controller and its shared service secret.
        self.controller_url = controller_url
        self.secret = secret or secrets.token_urlsafe(32)
        self.ws_key = secrets.token_urlsafe(12)
        self.ports = {k: free_port() for k in ("stub", "phone", "mock_llm", "voice")}
        if voice_port:
            self.ports["voice"] = voice_port
        self.stub = StubState(self.secret, placeholder_key=providers.llm == "mock", llm_model=keys.llm_model)
        self.mock = MockState()
        self.phone = FakeExotel(f"ws://127.0.0.1:{self.ports['voice']}", self.ws_key, self.stub.hear)
        self.max_concurrent = max_concurrent
        self.proc: subprocess.Popen[bytes] | None = None
        self.servers: list[tuple[uvicorn.Server, asyncio.Task[Any]]] = []
        self.recordings = out / "recordings"
        self.state_dir = out / "state"
        self.http = httpx.AsyncClient(timeout=30.0)
        self.restarts = 0
        self.voice_log = out / "voice-service.log"

    def url(self, name: str) -> str:
        return f"http://127.0.0.1:{self.ports[name]}"

    # ── processes ──

    async def _serve(self, app: Any, port: int) -> None:
        cfg = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", access_log=False, lifespan="off")
        server = uvicorn.Server(cfg)
        task = asyncio.ensure_future(server.serve())
        self.servers.append((server, task))
        for _ in range(100):
            if server.started:
                return
            await asyncio.sleep(0.05)
        raise RuntimeError(f"harness server on {port} did not start")

    async def start(self) -> None:
        self.out.mkdir(parents=True, exist_ok=True)
        await self._serve(create_stub(self.stub), self.ports["stub"])
        await self._serve(self.phone.app(), self.ports["phone"])
        await self._serve(create_mock_llm(self.mock), self.ports["mock_llm"])
        await self.start_voice()

    def voice_env(self) -> dict[str, str]:
        env = {k: v for k, v in os.environ.items()
               if k not in SHADOWING_VARS and k not in WIF_VARS and not k.startswith(("SARVAM", "EXOTEL", "TWILIO"))}
        env.update({
            "PYTHONPATH": os.pathsep.join([str(VOICE_SRC), str(HARNESS_DIR)]),
            "SERVICE_AUTH_SECRET": self.secret,
            "CONTROLLER_URL": self.controller_url or self.url("stub"),
            "PUBLIC_BASE_URL": self.url("voice"),
            "VOICE_WS_KEY": self.ws_key,
            "VOICE_STATE_DIR": str(self.state_dir),
            "MAX_CONCURRENT_CALLS": str(self.max_concurrent),
            "TELEPHONY_PROVIDER": "exotel",
            "EXOTEL_SID": "e2e-account",
            "EXOTEL_API_KEY": "e2e",
            "EXOTEL_API_TOKEN": "e2e",
            "EXOTEL_APP_ID": "e2e-app",
            "EXOTEL_CALLER_ID": EXOPHONE,
            "S3_BUCKET": "e2e-local",
            "LOG_LEVEL": "DEBUG",
            "VOICE_LLM_MODEL": self.keys.llm_model,
            "SARVAM_API_KEY": self.keys.sarvam if "real" in (self.providers.stt, self.providers.tts) else "e2e-mock",
        })
        if self.providers.llm == "real":
            env.update(self.keys.claude_env())
        elif self.controller_url:
            # A real controller's voice-config has no placeholder key; the mock brain ignores the value.
            env["ANTHROPIC_API_KEY"] = "e2e-mock"
        return env

    async def start_voice(self) -> None:
        cmd = [sys.executable, "-m", "e2e.serve_voice", "--port", str(self.ports["voice"]),
               "--phone-url", self.url("phone"), "--stub-url", self.url("stub"),
               "--mock-llm-url", self.url("mock_llm"), "--stt", self.providers.stt, "--tts", self.providers.tts,
               "--llm", self.providers.llm, "--recordings", str(self.recordings), "--cache-dir", str(CACHE_DIR / "bot"),
               *(["--force-exotel"] if self.controller_url else [])]
        log = self.voice_log.open("ab")
        log.write(f"\n=== voice-service start {time.strftime('%H:%M:%S')} ===\n".encode())
        log.flush()
        self.proc = subprocess.Popen(cmd, cwd=str(HARNESS_DIR), env=self.voice_env(), stdout=log, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(f"voice-service exited ({self.proc.returncode}); see {self.voice_log}")
            try:
                # Ready the way k8s sees it: /readyz (models preloaded), or /healthz on a build without it.
                r = await self.http.get(f"{self.url('voice')}/readyz", timeout=2.0)
                if r.status_code == 404:
                    r = await self.http.get(f"{self.url('voice')}/healthz", timeout=2.0)
                if r.status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            await asyncio.sleep(0.3)
        raise RuntimeError("voice-service did not become healthy in 90 s")

    def voice_alive(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    async def stop_voice(self, sig: int = signal.SIGTERM, wait_s: float = 40.0) -> None:
        if not self.voice_alive():
            return
        assert self.proc is not None
        self.proc.send_signal(sig)
        deadline = time.monotonic() + wait_s
        while self.proc.poll() is None and time.monotonic() < deadline:
            await asyncio.sleep(0.2)
        if self.proc.poll() is None:
            self.proc.kill()
            self.proc.wait(5)

    async def restart_voice(self) -> None:
        await self.stop_voice()
        self.restarts += 1
        await self.start_voice()

    async def close(self) -> None:
        await self.stop_voice()
        for server, task in self.servers:
            server.should_exit = True
        await asyncio.gather(*(t for _, t in self.servers), return_exceptions=True)
        await self.http.aclose()
        self.stub.write_log(self.out / "stub-controller.jsonl")

    # ── controls ──

    async def fault(self, call_id: str, kind: str | None) -> None:
        r = await self.http.post(f"{self.url('voice')}/__e2e/fault", json={"callId": call_id, "kind": kind})
        r.raise_for_status()

    def controller_fault(self, call_id: str, fault: Fault | None) -> None:
        if fault is None:
            self.stub.faults.pop(call_id, None)
        else:
            self.stub.faults[call_id] = fault

    async def place(self, call_id: str, language: str) -> tuple[int, dict[str, Any]]:
        try:
            r = await self.http.post(f"{self.url('voice')}/calls",
                                     headers={"authorization": f"Bearer {controller_token(self.secret)}"},
                                     json={"callId": call_id, "to": LEAD, "from": EXOPHONE, "language": language})
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            return r.status_code, body
        except httpx.HTTPError as e:
            return 0, {"error": type(e).__name__}

    def prewarm_mock_voice(self, contacts: list[dict[str, str]]) -> int:
        """Renders the mock TTS's lines up front (in its cache) so `say` time doesn't count as bot latency."""
        if self.providers.tts != "mock" or not audio.have_say():
            return 0
        import re

        from . import mock_llm, voice_patches
        from .config import CACHE_DIR as cache

        sys.path.insert(0, str(VOICE_SRC))
        from voice_service import phrases

        lines = list(mock_llm.mock_lines())
        lines += [prompt.SAYS[t]["en"].format(lang="Tamil") for t in prompt.SAYS]
        lines += phrases.FILLERS["en"] + [phrases.APOLOGIES["en"]]
        lines += [prompt.GREETINGS["en"].format(name="Priya", business=c["business"]) for c in contacts]
        parts = set(lines)
        for ln in lines:
            parts.update(p for p in re.split(r"(?<=[.!?])\s+", ln) if p.strip())
        voice = os.environ.get("E2E_BOT_SAY_VOICE", "Samantha")
        for p in parts:
            voice_patches.say_pcm(p, 8000, voice, cache / "bot")
        return len(parts)

    async def warmup(self, contact: dict[str, str]) -> float | None:
        """One unreported call right after voice-service starts: the first call pays for loading the VAD and Smart
        Turn models. Returns its time to greeting (the cold-start figure); the scenarios then run warm."""
        turns = [Turn(kind="hangup", when="bot_done", gap_s=0.3, max_wait_s=30, label="warm-up")]
        r = await self.run_call(name="warmup", idx=0, language="en", contact=contact, turns=turns, session={}, max_s=45,
                                terminal_wait_s=10)
        return r.metrics.get("time_to_first_greeting_s")

    # ── caller audio ──

    def caller_audio(self, text: str, language: str) -> bytes | None:
        """Sarvam Bulbul (a male voice, unlike the bot) when the key is there, else macOS `say` for English."""
        if self.keys.sarvam and self.providers.tts == "real":
            from . import sarvam

            voice = prompt.CALLER_VOICES.get(language, "rahul")
            key = audio.cache_key("sarvam", voice, language, text)
            return audio.cached_pcm(CACHE_DIR / "caller", key, lambda: sarvam.tts(text, language, voice, self.keys.sarvam))
        if language == "en" and audio.have_say():
            voice = os.environ.get("E2E_CALLER_SAY_VOICE", "Rishi")
            key = audio.cache_key("say", voice, text)
            return audio.cached_pcm(CACHE_DIR / "caller", key, lambda: audio.say_pcm(text, voice))
        return None

    # ── one call ──

    async def run_call(self, *, name: str, idx: int, language: str, contact: dict[str, str], turns: list[Turn],
                       session: dict[str, Any], answer: str = "answer", max_s: float = 90.0, post_terminal: bool = True,
                       terminal_wait_s: float = 40.0, hooks: dict[str, Any] | None = None, before: Any = None,
                       after_place: Any = None, end_wait_s: float = 10.0) -> CallResult:
        call_id = f"e2e-{name}-{idx}-{uuid.uuid4().hex[:6]}"
        self.stub.register(call_id, prompt.session(call_id, language, contact, **session))
        bound = {k: (lambda f=f: f(self, call_id)) for k, f in (hooks or {}).items()}
        plan = CallPlan(call_id=call_id, turns=turns, answer=answer, max_s=max_s, post_terminal=post_terminal, hooks=bound,
                        end_wait_s=end_wait_s)
        rec = self.phone.plan(plan)
        res = CallResult(call_id=call_id, rec=rec)
        if before is not None:
            await before(self, call_id)
        res.place_status, res.place_body = await self.place(call_id, language)
        if after_place is not None:
            await after_place(self, call_id, res)
        if res.place_status != 200:
            rec.notes.append(f"POST /calls -> {res.place_status} {res.place_body}")
            return res
        try:
            await asyncio.wait_for(rec.done.wait(), timeout=max_s + 30)
        except TimeoutError:
            rec.notes.append("caller never finished")
        await self.await_terminal(res, terminal_wait_s)
        await self.collect(res)
        return res

    async def await_terminal(self, res: CallResult, wait_s: float, settle_s: float = 3.0) -> None:
        deadline = time.monotonic() + wait_s
        while time.monotonic() < deadline and not self.stub.terminal_events(res.call_id):
            await asyncio.sleep(0.25)
        await asyncio.sleep(settle_s)  # catch a duplicate

    def turn_timeouts(self, rec: CallRecord) -> int | None:
        """Turns Smart Turn judged unfinished until VOICE_TURN_MAX_WAIT_S ran out, from voice-service's debug log
        within this call's time window (approximate when calls overlap)."""
        if not rec.e0 or not self.voice_log.exists():
            return None
        from datetime import datetime

        start, end = rec.e0, rec.e0 + (rec.closed_at or 0) + 1
        n = 0
        with self.voice_log.open(errors="replace") as f:
            for line in f:
                if "due to stop_secs" not in line:
                    continue
                try:
                    t = datetime.fromisoformat(line.split('"t": "', 1)[1].split('"', 1)[0].replace("Z", "+00:00")).timestamp()
                except (IndexError, ValueError):
                    continue
                n += start <= t <= end
        return n

    async def collect(self, res: CallResult) -> None:
        cid = res.call_id
        res.events = [r["body"] | {"_t": r["t"]} for r in self.stub.events(cid)]
        res.terminal = [r["body"] | {"_t": r["t"]} for r in self.stub.terminal_events(cid)]
        res.tools = [{"tool": r.get("tool"), "args": (r.get("body") or {}).get("args"), "reply": r.get("reply"),
                      "status": r["status"], "at": round(r["t"] - res.rec.e0, 3) if res.rec.e0 else None}
                     for r in self.stub.tools(cid)]
        if res.terminal:
            res.transcript = list((res.terminal[0].get("data") or {}).get("transcript") or [])
        if not res.transcript:
            for e in res.events:
                if e.get("type") == "transcript":
                    res.transcript.extend((e.get("data") or {}).get("turns") or [])
        if self.voice_alive():
            try:
                r = await self.http.get(f"{self.url('voice')}/__e2e/llm/{cid}", timeout=3.0)
                res.llm = r.json()
            except (httpx.HTTPError, ValueError):
                res.llm = {}
        rec = res.rec
        calls_dir = self.out / "calls"
        calls_dir.mkdir(parents=True, exist_ok=True)
        if rec.caller or rec.bot:
            res.files = [str(p.relative_to(self.out)) for p in audio.write_call_audio(calls_dir / cid, bytes(rec.caller), bytes(rec.bot))]
        res.marks.update(rec.hooks_run)
        stream_s = rec.closed_at or 0.0
        lat = metrics.response_latencies(rec)
        res.metrics = {
            "stream_s": round(stream_s, 2),
            "time_to_first_greeting_s": metrics.time_to_greeting(rec),
            "answer_to_greeting_s": round(rec.e0 - rec.answered_at + rec.bot_onsets[0], 3)
            if rec.bot_onsets and rec.answered_at and rec.e0 else None,
            "response_latencies": lat,
            "latency_p50_s": metrics.percentile([x["latency_s"] for x in lat], 50),
            "latency_p90_s": metrics.percentile([x["latency_s"] for x in lat], 90),
            "barge_ins": metrics.barge_ins(rec),
            "bot_onsets": rec.bot_onsets,
            "clears": rec.clears,
            "clear_dropped_s": rec.clear_dropped_s,
            "max_lead_s": rec.max_lead_s,
            "closed_by": rec.closed_by,
            "terminal_types": [t.get("type") for t in res.terminal],
            "tools": res.tool_names(),
            "turn_timeouts": self.turn_timeouts(rec),
            "caller_turns": len([u for u in rec.utterances if u.text]),
            "cost": metrics.cost(stream_s, len(res.agent_text()), res.llm or None),
        }
