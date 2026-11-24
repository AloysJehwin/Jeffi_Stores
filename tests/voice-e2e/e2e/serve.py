"""`run.py serve`: voice-service plus the simulated phone network, pointed at a real (local) controller, for the
outreach flow test (tests/outreach-e2e). Every call the controller places is answered by a simulated owner who goes
through the English happy path. Prints one JSON line when ready, then runs until interrupted.

  python tests/voice-e2e/run.py serve --controller-url http://localhost:3013 [--port 8095] [--live-keys]

The controller must use the same SERVICE_AUTH_SECRET (read from the env, else the repo's .env.local files; never
printed) and reach voice-service at http://127.0.0.1:<port>.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import signal
import time
from pathlib import Path

from .config import OUT_DIR, ROOT, load_keys, parse_env_file
from .harness import Harness
from .phone import CallPlan
from .runner import caller_turns, choose_providers, log
from .scenarios import by_name


def shared_secret() -> str:
    if os.environ.get("SERVICE_AUTH_SECRET"):
        return os.environ["SERVICE_AUTH_SECRET"]
    env: dict[str, str] = {}
    for name in (".env.local", ".env.local.overrides", "controller-service/.env.local"):
        env.update({k: v for k, v in parse_env_file(ROOT / name).items() if v})
    return env.get("SERVICE_AUTH_SECRET") or env.get("SERVICE_TOKEN_SECRET", "")


async def serve(controller_url: str, port: int, live: bool, script: str, out: Path) -> int:
    secret = shared_secret()
    if not secret:
        log("SERVICE_AUTH_SECRET not found (env or .env.local): the controller and voice-service must share it")
        return 2
    keys = load_keys()
    providers, note = await choose_providers(live, keys)
    h = Harness(out, providers, keys, controller_url=controller_url.rstrip("/"), secret=secret, voice_port=port)
    sc = by_name()[script]
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    try:
        await h.start()
        h.prewarm_mock_voice([sc.contact])
        turns, why = caller_turns(h, sc)
        if why:
            log(why)
            return 2
        h.phone.default_plan = lambda call_id: CallPlan(call_id=call_id, turns=[t for t in turns], max_s=sc.max_s)
        print(json.dumps({"ready": True, "voiceUrl": h.url("voice"), "phoneUrl": h.url("phone"),
                          "providers": providers.label(), "claude": note if live else "mocked", "script": script}), flush=True)
        await stop.wait()
    finally:
        await h.close()
        summary = [{"callId": r.call_id, "closedBy": r.closed_by, "said": [u.label for u in r.utterances], "notes": r.notes}
                   for r in h.phone.records.values()]
        (out / "serve-calls.json").write_text(json.dumps(summary, indent=2))
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="run.py serve")
    ap.add_argument("--controller-url", default=os.environ.get("OUTREACH_E2E_CONTROLLER_URL", "http://localhost:3013"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("OUTREACH_E2E_VOICE_PORT", "8095")))
    ap.add_argument("--live-keys", action="store_true")
    ap.add_argument("--script", default="happy_en")
    ap.add_argument("--out", default="")
    a = ap.parse_args(argv)
    out = Path(a.out) if a.out else OUT_DIR / f"serve-{time.strftime('%Y%m%d-%H%M%S')}"
    out.mkdir(parents=True, exist_ok=True)
    return asyncio.run(serve(a.controller_url, a.port, a.live_keys, a.script, out))
