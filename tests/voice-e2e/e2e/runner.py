"""Choosing providers, the spend cap, running the selected scenarios and writing the report."""

from __future__ import annotations

import asyncio
import dataclasses
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from . import audio, report
from .config import OUT_DIR, ROOT, WIF_MINT, Keys, load_keys
from .harness import CallResult, Harness, Providers
from .phone import Turn
from .scenarios import EN, Scenario, all_scenarios


def log(msg: str) -> None:
    print(f"[voice-e2e {time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ── Claude through workload identity federation ──

def mint_wif_token(keys: Keys, max_age_s: float = 1800) -> str:
    age = keys.token_age_s()
    if age is not None and age < max_age_s:
        return f"WIF token is {age / 60:.0f} min old"
    node = shutil.which("node", path=os.pathsep.join([str(Path.home() / ".nvm/versions/node/v24.5.0/bin"), os.environ.get("PATH", "")]))
    if not node or not WIF_MINT.exists():
        return "could not mint a WIF token (node or ai-platform/scripts/local-wif-token.mjs missing)"
    r = subprocess.run([node, str(WIF_MINT), "mint"], cwd=str(ROOT), capture_output=True, timeout=30)
    return "minted a fresh WIF token (valid 1h)" if r.returncode == 0 else f"WIF mint failed (exit {r.returncode})"


async def claude_preflight(keys: Keys) -> tuple[bool, str]:
    """One tiny request through federation, with the client voice-service itself builds (llm_client.py, explicit
    credentials, so no env variable can shadow it). Spots an expired token and the spend limit before any call."""
    import anthropic

    from .vs import VOICE_SRC  # noqa: F401  (voice-service on the path)
    from voice_service.llm_client import build_llm_client
    from voice_service.provider_config import AnthropicIdentity, VoiceConfig

    w = keys.wif
    cfg = VoiceConfig(provider="exotel", anthropic_identity_token_file=w.get("ANTHROPIC_IDENTITY_TOKEN_FILE", ""),
                      anthropic_identity=AnthropicIdentity(
                          organization_id=w.get("ANTHROPIC_ORGANIZATION_ID", ""), workspace_id=w.get("ANTHROPIC_WORKSPACE_ID", ""),
                          service_account_id=w.get("ANTHROPIC_SERVICE_ACCOUNT_ID", ""),
                          federation_rule_id=w.get("ANTHROPIC_FEDERATION_RULE_ID", "")))
    if not cfg.identity_ready():
        return False, "Claude WIF incomplete: " + ", ".join(cfg.claude_missing())
    try:
        client = build_llm_client(cfg).with_options(max_retries=0)
        await client.messages.create(model=keys.llm_model, max_tokens=16,
                                     messages=[{"role": "user", "content": "Reply with the word ok."}])
        return True, "reachable through workload identity federation"
    except anthropic.BadRequestError as e:
        if "usage limit" in str(e).lower():
            return False, "Claude blocked: workspace spend limit (Anthropic returned 400 'workspace API usage limits')"
        return False, f"Claude refused the request (400): {type(e).__name__}"
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as e:
        return False, (f"Claude auth failed ({e.status_code}) through WIF: mint a fresh token "
                       "(node ai-platform/scripts/local-wif-token.mjs mint) and check the WIF variables")
    except Exception as e:  # noqa: BLE001
        return False, f"Claude unreachable: {type(e).__name__}"


async def check_keys() -> int:
    """`run.py --check-keys`: what is configured (names only), and whether Claude answers. Places no call."""
    keys = load_keys()
    log(f"keys: {keys}; missing: {', '.join(keys.missing()) or 'nothing'}")
    if keys.claude_ready:
        log(mint_wif_token(keys))
        ok, note = await claude_preflight(keys)
        log(f"Claude: {note}")
        return 0 if ok else 1
    return 1


async def choose_providers(live: bool, keys: Keys) -> tuple[Providers, str]:
    if not live:
        return Providers(), "mocked (no-key run)"
    p = Providers()
    if keys.sarvam:
        p.stt = p.tts = "real"
    note = "not configured"
    if keys.claude_ready:
        log(mint_wif_token(keys))
        ok, note = await claude_preflight(keys)
        if ok:
            p.llm = "real"
    return p, note


# ── scenarios ──

def caller_turns(h: Harness, sc: Scenario) -> tuple[list[Turn], str]:
    turns = [dataclasses.replace(t) for t in sc.turns]
    for t in turns:
        if t.kind == "say":
            pcm = h.caller_audio(t.text, sc.language)
            if pcm is None:
                return [], f"no caller voice for {sc.language}: needs SARVAM_API_KEY (macOS `say` covers English only)"
            t.pcm = pcm
        elif t.kind == "audio":
            pcm = h.caller_audio(t.text, sc.language) if t.text else b""
            if pcm is None:
                return [], "no caller voice"
            t.pcm = pcm + audio.silence(0.1) + audio.beep(1.0) + audio.silence(1.0)
        elif t.kind == "beep":
            t.pcm = audio.beep(1.2) + audio.silence(1.0)
    return turns, ""


def fidelity(r: CallResult, language: str, key: str) -> dict[str, Any]:
    from . import metrics, sarvam

    ref = r.agent_text()
    segs = audio.speech_segments(bytes(r.rec.bot), hangover_s=0.8)
    if not ref or not segs:
        return {"wer": None, "reason": "no bot speech"}
    hyp = []
    for s in segs:
        start, end = s.start, min(s.end, s.start + 25)
        clip = bytes(r.rec.bot[int(start * audio.RATE) * 2 : int(end * audio.RATE) * 2])
        try:
            hyp.append(sarvam.stt(clip, audio.RATE, language, key))
        except Exception as e:  # noqa: BLE001
            return {"wer": None, "reason": f"stt failed: {type(e).__name__}"}
    text = " ".join(hyp)
    return {"wer": metrics.wer(ref, text), "cer": metrics.cer(ref, text), "heard": text[:600]}


async def run_one(h: Harness, sc: Scenario) -> tuple[list[CallResult], list[dict[str, Any]], str]:
    if sc.custom is not None:
        rs, checks = await sc.custom(h, sc)
        return rs, checks, ""
    turns, why = caller_turns(h, sc)
    if why:
        return [], [], why
    rs = []
    for i in range(sc.calls):
        rs.append(await h.run_call(name=sc.name, idx=i, language=sc.language, contact=sc.contact,
                                   turns=[dataclasses.replace(t) for t in turns], session=sc.session, answer=sc.answer,
                                   max_s=sc.max_s, post_terminal=sc.post_terminal, terminal_wait_s=sc.terminal_wait_s,
                                   hooks=sc.hooks, before=sc.before, after_place=sc.after_place, end_wait_s=sc.end_wait_s))
    checks = sc.check(h, rs) if sc.check else []
    return rs, checks, ""


def budget_minutes(scenarios: list[Scenario]) -> float:
    return round(sum(sc.budget_min for sc in scenarios), 2)


def select(names: list[str], groups: list[str]) -> list[Scenario]:
    every = all_scenarios()
    if not names and not groups:
        return every
    known = {s.name for s in every}
    unknown = [n for n in names if n not in known]
    if unknown:
        raise SystemExit(f"unknown scenario(s): {', '.join(unknown)}. Known: {', '.join(sorted(known))}")
    return [s for s in every if s.name in names or s.group in groups]


def git_commit() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=str(ROOT), capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:  # noqa: BLE001
        return "?"


async def run(names: list[str], groups: list[str], live: bool, max_minutes: float, out: Path | None) -> int:
    keys = load_keys()
    if live and not keys.sarvam and not keys.claude_ready:
        log("--live-keys, but nothing is configured: " + "; ".join(keys.missing()) + ". Fill ~/.jeffi/voice-e2e.env.")
        return 2
    providers, claude_note = await choose_providers(live, keys)
    have = {"sarvam": providers.stt == "real", "claude": providers.llm == "real"}
    chosen = select(names, groups)
    plan: list[tuple[Scenario, str]] = []
    for sc in chosen:
        missing = [n for n in sc.needs if not have[n]]
        if missing:
            why = []
            if "sarvam" in missing:
                why.append("needs Sarvam (SARVAM_API_KEY in ~/.jeffi/voice-e2e.env, run with --live-keys)")
            if "claude" in missing:
                why.append(claude_note if live and keys.claude_ready else "needs Claude (WIF variables, run with --live-keys)")
            plan.append((sc, "; ".join(why)))
        else:
            plan.append((sc, ""))
    runnable = [sc for sc, why in plan if not why]
    if providers.any_real:
        budget = budget_minutes(runnable)
        if budget > max_minutes:
            log(f"refusing to run: the selected live scenarios could use up to {budget:.1f} call minutes, over the cap of "
                f"{max_minutes:.0f} (--max-minutes). Pick fewer with --scenario, or raise the cap.")
            for sc in runnable:
                log(f"  {sc.name}: up to {sc.budget_min:.1f} min")
            return 2
    started = time.strftime("%Y-%m-%d %H:%M:%S")
    out = out or OUT_DIR / time.strftime("%Y%m%d-%H%M%S")
    out.mkdir(parents=True, exist_ok=True)
    mode = "live" if providers.any_real else "no-key"
    log(f"{mode} run: {providers.label()}; keys {keys}; output {out}")
    if live and providers.llm != "real":
        log(f"Claude: {claude_note}")
    h = Harness(out, providers, keys)
    t_start = time.monotonic()
    results: list[report.ScenarioResult] = []
    spent_min = 0.0
    try:
        await h.start()
        n = h.prewarm_mock_voice([EN])
        if n:
            log(f"pre-rendered {n} mock bot lines")
        cold_greeting = await h.warmup(EN)
        log(f"warm-up call: greeting after {cold_greeting}s (cold start)")
        for sc, why in plan:
            res = report.ScenarioResult(sc.name, sc.group, sc.title, sc.proves, "skip", reason=why, providers=providers.label(),
                                        plumbing_only=sc.plumbing_only_when_mocked and providers.llm == "mock")
            results.append(res)
            if why:
                log(f"skip {sc.name}: {why}")
                continue
            if providers.any_real and spent_min + sc.budget_min > max_minutes:
                res.reason = f"spend cap: {spent_min:.1f} of {max_minutes:.0f} call minutes used"
                log(f"skip {sc.name}: {res.reason}")
                continue
            if not h.voice_alive():
                await h.start_voice()
            log(f"run  {sc.name}: {sc.title}")
            t0 = time.monotonic()
            try:
                rs, checks, why2 = await run_one(h, sc)
            except Exception as e:  # noqa: BLE001
                res.status, res.reason = "error", f"{type(e).__name__}: {e}"
                log(f"     error: {res.reason}")
                continue
            if why2:
                res.reason = why2
                continue
            if providers.stt == "real" and keys.sarvam:
                for r in rs:
                    r.metrics["fidelity"] = await asyncio.to_thread(fidelity, r, sc.language, keys.sarvam)
            spent_min += sum(r.metrics.get("stream_s", 0) for r in rs) / 60 if providers.any_real else 0
            res.seconds = round(time.monotonic() - t0, 1)
            res.assertions = checks
            res.calls = [report.call_summary(r) for r in rs]
            blocked = next((r.llm.get("blocked") for r in rs if r.llm.get("blocked")), None)
            if blocked == "workspace_spend_limit":
                res.status, res.reason = "blocked", "Claude blocked: workspace spend limit"
            elif blocked:
                res.status, res.reason = "blocked", f"Claude refused ({blocked}): mint a fresh WIF token"
            else:
                res.status = "pass" if checks and all(a["ok"] for a in checks) else "fail"
            log(f"     {res.status.upper()} in {res.seconds}s" + "".join(f"\n       FAIL {a['name']}: {a['detail'][:200]}" for a in checks if not a["ok"]))
    finally:
        await h.close()
    meta = {"started": started, "mode": mode, "cold_greeting_s": locals().get("cold_greeting"), "providers": providers.label(), "claude": claude_note if live else "",
            "commit": git_commit(), "pipecat": _pipecat_version(), "llm_model": keys.llm_model,
            "max_concurrent": h.max_concurrent, "seconds": round(time.monotonic() - t_start), "live_minutes": round(spent_min, 2)}
    jp, mp = report.write(out, meta, results)
    log(f"report: {mp}")
    return 1 if any(r.status in ("fail", "error") for r in results) else 0


def _pipecat_version() -> str:
    try:
        from importlib.metadata import version

        return version("pipecat-ai")
    except Exception:  # noqa: BLE001
        return "?"
