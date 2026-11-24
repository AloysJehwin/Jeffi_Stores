#!/usr/bin/env python3
"""Voice-to-voice E2E harness for voice-service (docs/OUTREACH_E2E.md).

  python tests/voice-e2e/run.py                       # every scenario that can run; no keys needed
  python tests/voice-e2e/run.py --scenario barge_in,silence
  python tests/voice-e2e/run.py --group resilience
  python tests/voice-e2e/run.py --live-keys            # real Sarvam + Claude (WIF), capped at --max-minutes
  python tests/voice-e2e/run.py --list
  python tests/voice-e2e/run.py serve --controller-url http://localhost:3013   # for the outreach flow test

It runs under tests/voice-e2e/.venv (voice-service's pinned deps), creating it on first use.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENV = HERE / ".venv"
VENV_PY = VENV / "bin" / "python"
ROOT = HERE.parent.parent


def ensure_venv() -> None:
    if Path(sys.prefix).resolve() == VENV.resolve():
        return
    if not VENV_PY.exists():
        print("[voice-e2e] creating tests/voice-e2e/.venv with voice-service's pinned deps (one time)...", flush=True)
        reqs = ["-r", str(ROOT / "voice-service/requirements.txt"), "-r", str(ROOT / "voice-service/requirements-dev.txt")]
        if subprocess.run(["uv", "--version"], capture_output=True).returncode == 0:
            subprocess.run(["uv", "venv", "--python", "3.12", str(VENV)], check=True)
            subprocess.run(["uv", "pip", "install", "--python", str(VENV_PY), *reqs], check=True)
        else:
            subprocess.run(["python3.12", "-m", "venv", str(VENV)], check=True)
            subprocess.run([str(VENV_PY), "-m", "pip", "install", "-q", *reqs], check=True)
    os.execv(str(VENV_PY), [str(VENV_PY), str(Path(__file__).resolve()), *sys.argv[1:]])


def main() -> int:
    ensure_venv()
    sys.path.insert(0, str(HERE))
    if len(sys.argv) > 1 and sys.argv[1] == "serve":
        from e2e.serve import main as serve_main

        return serve_main(sys.argv[2:])
    import asyncio

    from e2e.runner import run
    from e2e.scenarios import all_scenarios

    ap = argparse.ArgumentParser(description="voice-service E2E harness")
    ap.add_argument("--scenario", default="", help="comma-separated scenario names")
    ap.add_argument("--group", default="", help="comma-separated groups: protocol, conversation, load, resilience")
    ap.add_argument("--live-keys", action="store_true", help="use real Sarvam and Claude from ~/.jeffi/voice-e2e.env")
    ap.add_argument("--max-minutes", type=float, default=float(os.environ.get("E2E_MAX_MINUTES", "15")),
                    help="cap on live call minutes (default 15)")
    ap.add_argument("--out", default="", help="output folder (default tests/voice-e2e/out/<timestamp>)")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--check-keys", action="store_true", help="report which keys are set and whether Claude answers; no calls")
    a = ap.parse_args()
    if a.check_keys:
        from e2e.runner import check_keys

        return asyncio.run(check_keys())
    if a.list:
        for s in all_scenarios():
            needs = ",".join(sorted(s.needs)) or "no keys"
            print(f"{s.name:26} {s.group:12} {needs:14} {s.title}")
        return 0
    names = [x.strip() for x in a.scenario.split(",") if x.strip()]
    groups = [x.strip() for x in a.group.split(",") if x.strip()]
    return asyncio.run(run(names, groups, a.live_keys, a.max_minutes, Path(a.out) if a.out else None))


if __name__ == "__main__":
    sys.exit(main())
