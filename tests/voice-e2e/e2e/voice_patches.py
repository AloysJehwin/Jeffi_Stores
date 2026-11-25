"""Loaded inside the voice-service process the harness starts (serve_voice.py). voice-service's own code is untouched:
only what sits at its edges is swapped.

- Telephony: an Exotel transport that places calls on the harness's fake Exotel API instead of api.in.exotel.com
  (same form, same response parsing, same status callbacks and media protocol).
- Providers, per kind: real Sarvam STT/TTS and real Claude (through workload identity federation), or mocks
  (an energy-segmenting STT that reports the caller's scripted words, a `say`-based TTS, the scripted brain).
- Faults: armed per call over POST /__e2e/fault; applied where the real service would surface them (an ErrorFrame
  from the processor, audio that never comes, an APIStatusError from the Anthropic client).
- Claude usage and time to first token per call, read over GET /__e2e/llm/{callId}.
"""

from __future__ import annotations

import asyncio
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import Request  # module level: FastAPI resolves the (postponed) annotations against these globals
from fastapi.responses import JSONResponse

CURRENT_CALL: str | None = None
FAULTS: dict[str, str] = {}
LLM_USAGE: dict[str, dict[str, Any]] = {}
REF = re.compile(r"ref:([A-Za-z0-9_.-]+)")
SPEECH_DBFS = -40.0


def _dbfs(pcm: bytes) -> float:
    import numpy as np

    x = np.frombuffer(pcm[: len(pcm) - len(pcm) % 2], dtype=np.int16).astype(np.float64)
    if x.size == 0:
        return -120.0
    rms = float(np.sqrt(np.mean(x * x))) / 32768.0
    return 20 * float(np.log10(rms)) if rms > 0 else -120.0


def _api_error(status: int) -> Exception:
    from sarvamai.core.api_error import ApiError

    return ApiError(status_code=status, body="e2e fault")


# ── telephony ──

def sim_transport_factory(phone_url: str):  # type: ignore[no-untyped-def]
    from voice_service.transports.base import PlaceRequest, TransportError
    from voice_service.transports.exotel import ExotelTransport

    class SimExotelTransport(ExotelTransport):
        async def place_call(self, req: PlaceRequest) -> str:
            url = f"{phone_url}/v1/Accounts/{self.sid}/Calls/connect.json"
            try:
                r = await self._http.post(url, data=self.connect_form(req), auth=self._auth, timeout=15.0)
            except httpx.HTTPError as e:
                raise TransportError(f"exotel unreachable: {type(e).__name__}") from e
            if r.status_code >= 300:
                raise TransportError(f"exotel connect {r.status_code}", r.status_code)
            try:
                sid = r.json()["Call"]["Sid"]
            except (ValueError, KeyError, TypeError) as e:
                raise TransportError("exotel connect: no Call.Sid") from e
            return str(sid)

    def factory(cfg: Any, http: httpx.AsyncClient) -> Any:
        return SimExotelTransport(sid=cfg.exotel_sid, api_key=cfg.exotel_api_key, api_token=cfg.exotel_api_token,
                                  subdomain=cfg.exotel_subdomain, app_id=cfg.exotel_app_id,
                                  caller_id=cfg.exotel_caller_id, http=http)

    return factory


def local_uploader(root: Path):  # type: ignore[no-untyped-def]
    """Recordings land on disk instead of S3 (S3_BUCKET=e2e-local)."""

    def upload(bucket: str, key: str, body: bytes, content_type: str) -> None:
        p = root / key
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(body)

    return upload


# ── STT ──

def _stt_classes(stub_url: str):  # type: ignore[no-untyped-def]
    from pipecat.frames.frames import TranscriptionFrame
    from pipecat.services.sarvam.stt import SarvamSTTService
    from pipecat.services.stt_service import STTService
    from pipecat.utils.time import time_now_iso8601

    async def gate(svc: Any) -> bool:
        """True: drop this audio (the fault is on)."""
        f = FAULTS.get(svc._e2e_call or "")
        if f == "stt_5xx":
            if not svc._e2e_errored:
                svc._e2e_errored = True
                await svc.push_error(error_msg="Sarvam API error: 503 (e2e fault)", exception=_api_error(503))
            return True
        return f == "stt_timeout"

    class FaultySarvamSTT(SarvamSTTService):
        def __init__(self, *a: Any, **kw: Any) -> None:
            super().__init__(*a, **kw)
            self._e2e_call, self._e2e_errored = CURRENT_CALL, False

        async def run_stt(self, audio: bytes):  # type: ignore[no-untyped-def]
            if await gate(self):
                yield None
                return
            async for f in super().run_stt(audio):
                yield f

    class MockSTT(STTService):
        """Segments the caller's audio by energy; at each segment's end reports the words the simulated caller was
        scripted to say then (from the harness's stub). No recognition: it proves the plumbing only."""

        Settings = SarvamSTTService.Settings

        def __init__(self, *, api_key: str | None = None, mode: str | None = None, settings: Any = None, **kw: Any) -> None:
            super().__init__(settings=settings, **kw)
            self._e2e_call, self._e2e_errored = CURRENT_CALL, False
            self._seg_start: float | None = None
            self._last_voice = 0.0
            self._http = httpx.AsyncClient(timeout=5.0)

        async def _emit(self, start: float) -> None:
            try:
                r = await self._http.get(f"{stub_url}/__e2e/heard/{self._e2e_call}", params={"at": start})
                text = str(r.json().get("text") or "")
            except Exception:  # noqa: BLE001
                text = ""
            if text and FAULTS.get(self._e2e_call or "") not in ("stt_5xx", "stt_timeout"):
                await self.push_frame(TranscriptionFrame(text=text, user_id="", timestamp=time_now_iso8601(),
                                                         language=self._settings.language, finalized=True))

        async def run_stt(self, audio: bytes):  # type: ignore[no-untyped-def]
            if await gate(self):
                yield None
                return
            now = time.time()
            frame_s = len(audio) / 2 / (self.sample_rate or 16000)
            if _dbfs(audio) > SPEECH_DBFS:
                if self._seg_start is None:
                    self._seg_start = now - frame_s
                self._last_voice = now
            elif self._seg_start is not None and now - self._last_voice >= 0.35:
                start, self._seg_start = self._seg_start, None
                self.create_task(self._emit(start))
            yield None

    return FaultySarvamSTT, MockSTT


# ── TTS ──

_SAY_CACHE: dict[tuple[str, int], bytes] = {}


def say_pcm(text: str, rate: int, voice: str, cache_dir: Path | None) -> bytes:
    key = (text, rate)
    if key in _SAY_CACHE:
        return _SAY_CACHE[key]
    import hashlib

    f = cache_dir / f"bot-{hashlib.sha1(f'{voice}|{rate}|{text}'.encode()).hexdigest()[:20]}.pcm" if cache_dir else None
    if f is not None and f.exists():
        pcm = f.read_bytes()
    else:
        with tempfile.TemporaryDirectory() as d:
            aiff = Path(d) / "b.aiff"
            subprocess.run(["say", "-v", voice, "-o", str(aiff), text], check=True, capture_output=True, timeout=60)
            pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(aiff), "-ac", "1", "-ar", str(rate),
                                  "-f", "s16le", "-"], check=True, capture_output=True, timeout=60).stdout
        if f is not None:
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(pcm)
    _SAY_CACHE[key] = pcm
    return pcm


def _tts_classes(cache_dir: Path | None, voice: str):  # type: ignore[no-untyped-def]
    from pipecat.frames.frames import TTSAudioRawFrame
    from pipecat.services.sarvam.tts import SarvamTTSService
    from pipecat.services.tts_service import TTSService

    async def gate(svc: Any) -> bool:
        f = FAULTS.get(svc._e2e_call or "")
        if f == "tts_5xx":
            await svc.push_error(error_msg="Sarvam TTS error: 503 (e2e fault)", exception=_api_error(503))
            return True
        return f == "tts_timeout"

    class FaultySarvamTTS(SarvamTTSService):
        def __init__(self, *a: Any, **kw: Any) -> None:
            super().__init__(*a, **kw)
            self._e2e_call = CURRENT_CALL

        async def run_tts(self, text: str, context_id: str):  # type: ignore[no-untyped-def]
            if await gate(self):
                yield None
                return
            async for f in super().run_tts(text, context_id):
                yield f

    class MockTTS(TTSService):
        """macOS `say` (cached), so recordings are listenable without a key."""

        Settings = SarvamTTSService.Settings

        def __init__(self, *, api_key: str | None = None, settings: Any = None, **kw: Any) -> None:
            super().__init__(push_stop_frames=True, push_start_frame=True, settings=settings, **kw)
            self._e2e_call = CURRENT_CALL

        def can_generate_metrics(self) -> bool:
            return False

        async def run_tts(self, text: str, context_id: str):  # type: ignore[no-untyped-def]
            if await gate(self):
                yield None
                return
            rate = self.sample_rate or 8000
            pcm = await asyncio.to_thread(say_pcm, text, rate, voice, cache_dir)
            yield TTSAudioRawFrame(audio=pcm, sample_rate=rate, num_channels=1, context_id=context_id)

    return FaultySarvamTTS, MockTTS


# ── Claude ──

class _Tee:
    """Wraps the Anthropic stream to read usage and time to first token as pipecat consumes it."""

    def __init__(self, inner: Any, usage: dict[str, Any], t0: float) -> None:
        self._inner, self._u, self._t0 = inner, usage, t0

    def __aiter__(self):  # type: ignore[no-untyped-def]
        return self._gen()

    async def _gen(self):  # type: ignore[no-untyped-def]
        first = True
        async for ev in self._inner:
            t = getattr(ev, "type", "")
            if first and t in ("content_block_start", "content_block_delta"):
                self._u["ttft_ms"].append(round((time.monotonic() - self._t0) * 1000, 1))
                first = False
            if t == "message_start":
                us = getattr(getattr(ev, "message", None), "usage", None)
                if us is not None:
                    self._u["input_tokens"] += int(getattr(us, "input_tokens", 0) or 0)
                    self._u["cache_creation_input_tokens"] += int(getattr(us, "cache_creation_input_tokens", 0) or 0)
                    self._u["cache_read_input_tokens"] += int(getattr(us, "cache_read_input_tokens", 0) or 0)
            elif t == "message_delta":
                us = getattr(ev, "usage", None)
                if us is not None:
                    self._u["output_tokens"] += int(getattr(us, "output_tokens", 0) or 0)
            yield ev

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


def _usage(call_id: str) -> dict[str, Any]:
    return LLM_USAGE.setdefault(call_id, {"requests": 0, "input_tokens": 0, "output_tokens": 0,
                                          "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0,
                                          "ttft_ms": [], "errors": [], "faults_injected": 0, "blocked": None})


def _system_text(params: dict[str, Any]) -> str:
    s = params.get("system")
    if isinstance(s, str):
        return s
    if isinstance(s, list):
        return " ".join(str(b.get("text", "")) for b in s if isinstance(b, dict))
    return ""


def classify_claude_error(status: int, message: str) -> str | None:
    m = message.lower()
    if status == 400 and "usage limit" in m:
        return "workspace_spend_limit"
    if status in (401, 403):
        return f"auth_{status}"
    return None


def _wrap_client(client: Any) -> Any:
    import anthropic
    import httpx2

    messages = client.beta.messages
    orig = messages.create

    async def create(**params: Any) -> Any:
        m = REF.search(_system_text(params))
        call_id = m.group(1) if m else "unknown"
        u = _usage(call_id)
        u["requests"] += 1
        fault = FAULTS.get(call_id)
        req = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
        if fault == "llm_5xx":
            u["faults_injected"] += 1
            raise anthropic.InternalServerError("e2e fault: internal error", response=httpx2.Response(500, request=req), body=None)
        if fault == "llm_timeout":
            u["faults_injected"] += 1
            await asyncio.sleep(60)
            raise anthropic.APITimeoutError(request=req)
        t0 = time.monotonic()
        try:
            stream = await orig(**params)
        except anthropic.APIStatusError as e:
            u["errors"].append(e.status_code)
            u["blocked"] = u["blocked"] or classify_claude_error(e.status_code, str(e))
            raise
        except anthropic.APIConnectionError as e:
            u["errors"].append(type(e).__name__)
            raise
        return _Tee(stream, u, t0)

    messages.create = create
    return client


def _llm_factory(kind: str, mock_url: str, orig: Any):  # type: ignore[no-untyped-def]
    """Stands in for voice_service.llm_client.build_llm_client: the mock brain, or voice-service's own client
    (workload identity federation from its config) wrapped to read usage and inject faults."""

    def build_llm_client(cfg: Any) -> Any:
        if kind == "mock":
            import anthropic

            return _wrap_client(anthropic.AsyncAnthropic(api_key="e2e-mock", base_url=mock_url))
        return _wrap_client(orig(cfg))

    return build_llm_client


def _force_exotel() -> None:
    """Serve mode: whatever provider the real controller names (twilio_test in test mode), the simulated network
    speaks Exotel, with dummy Exotel credentials (real ones are never sent to the fake)."""
    import dataclasses

    from voice_service import provider_config as pc

    orig_get = pc.ProviderConfigSource.get

    async def get(self: Any) -> Any:
        cfg = await orig_get(self)
        return dataclasses.replace(cfg, provider="exotel", exotel_sid="e2e-account", exotel_api_key="e2e",
                                   exotel_api_token="e2e", exotel_app_id="e2e-app",
                                   exotel_caller_id=cfg.exotel_caller_id or "+911400000000")

    pc.ProviderConfigSource.get = get  # type: ignore[method-assign]


# ── install ──

def install(*, stt: str, tts: str, llm: str, stub_url: str, mock_llm_url: str, cache_dir: Path | None,
            force_exotel: bool = False) -> None:
    global CURRENT_CALL
    import pipecat.services.sarvam.stt as stt_mod
    import pipecat.services.sarvam.tts as tts_mod
    import voice_service.pipeline as pl

    faulty_stt, mock_stt = _stt_classes(stub_url)
    stt_mod.SarvamSTTService = mock_stt if stt == "mock" else faulty_stt
    faulty_tts, mock_tts = _tts_classes(cache_dir, os.environ.get("E2E_BOT_SAY_VOICE", "Samantha"))
    tts_mod.SarvamTTSService = mock_tts if tts == "mock" else faulty_tts
    pl.build_llm_client = _llm_factory(llm, mock_llm_url, pl.build_llm_client)
    if force_exotel:
        _force_exotel()

    orig = pl.build_pipeline

    def build_pipeline(websocket: Any, rt: Any, serializer: Any) -> Any:
        global CURRENT_CALL
        CURRENT_CALL = rt.call.call_id
        try:
            return orig(websocket, rt, serializer)
        finally:
            CURRENT_CALL = None

    pl.build_pipeline = build_pipeline


def add_routes(app: Any) -> None:
    @app.post("/__e2e/fault")
    async def fault(request: Request) -> JSONResponse:
        body = await request.json()
        cid, kind = str(body.get("callId") or ""), body.get("kind")
        if kind:
            FAULTS[cid] = str(kind)
        else:
            FAULTS.pop(cid, None)
        return JSONResponse({"ok": True})

    @app.get("/__e2e/llm/{call_id}")
    async def llm_usage(call_id: str) -> JSONResponse:
        return JSONResponse(LLM_USAGE.get(call_id) or {})
