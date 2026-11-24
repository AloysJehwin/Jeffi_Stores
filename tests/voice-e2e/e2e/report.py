"""report.json (everything) and report.md (what a person reads)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .metrics import percentile


@dataclass
class ScenarioResult:
    name: str
    group: str
    title: str
    proves: str
    status: str  # pass | fail | skip | blocked | error
    reason: str = ""
    providers: str = ""
    plumbing_only: bool = False
    seconds: float = 0.0
    assertions: list[dict[str, Any]] = field(default_factory=list)
    calls: list[dict[str, Any]] = field(default_factory=list)


def call_summary(r: Any) -> dict[str, Any]:
    return {
        "callId": r.call_id,
        "place": {"status": r.place_status, "body": r.place_body},
        "terminal": [{"type": t.get("type"), "reason": (t.get("data") or {}).get("reason"),
                      "durationS": (t.get("data") or {}).get("durationS"),
                      "durationSource": (t.get("data") or {}).get("durationSource"),
                      "redialLanguage": (t.get("data") or {}).get("redialLanguage")} for t in r.terminal],
        "events": [e.get("type") for e in r.events],
        "tools": [{k: t.get(k) for k in ("tool", "args", "status", "at")} for t in r.tools],
        "transcript": r.transcript,
        "metrics": r.metrics,
        "llm": r.llm,
        "files": r.files,
        "notes": r.rec.notes,
    }


def _fmt(v: Any, unit: str = "s", nd: int = 2) -> str:
    return "n/a" if v is None else f"{v:.{nd}f}{unit}"


def key_numbers(results: list[ScenarioResult]) -> dict[str, Any]:
    calls = [c for s in results for c in s.calls]
    lat = [x["latency_s"] for c in calls for x in c["metrics"].get("response_latencies", [])]
    greet = [c["metrics"].get("time_to_first_greeting_s") for c in calls if c["metrics"].get("time_to_first_greeting_s") is not None]
    barge = [b for c in calls for b in c["metrics"].get("barge_ins", []) if b.get("bot_was_speaking")]
    stops = [b["stop_s"] for b in barge if b.get("stop_s") is not None]
    clears = [b["clear_s"] for b in barge if b.get("clear_s") is not None]
    placed = [c for c in calls if c["place"]["status"] == 200]
    one = [c for c in placed if len(c["terminal"]) == 1]
    tool_checks = [a for s in results for a in s.assertions if a["name"].startswith(("tools called", "startPreview", "optOut",
                   "switchLanguage", "publishSite", "consent recorded", "the slow tool"))]
    fid = [c["metrics"]["fidelity"] for c in calls if isinstance(c["metrics"].get("fidelity"), dict) and c["metrics"]["fidelity"].get("wer") is not None]
    seq = [c for s in results if s.group != "load" for c in s.calls if c["metrics"].get("turn_timeouts") is not None]
    timeouts = sum(c["metrics"]["turn_timeouts"] for c in seq)
    caller_turns = sum(c["metrics"].get("caller_turns", 0) for c in seq)
    costs = [c["metrics"]["cost"] for c in calls if c["metrics"].get("cost") and c["metrics"]["cost"]["minutes"] > 0]
    total_min = sum(x["minutes"] for x in costs)
    total_inr = sum(x["total_inr"] for x in costs)
    return {
        "latency": {"p50": percentile(lat, 50), "p90": percentile(lat, 90), "n": len(lat)},
        "greeting": {"p50": percentile(greet, 50), "p90": percentile(greet, 90), "n": len(greet)},
        "barge_in": {"stop_p50": percentile(stops, 50), "stop_max": max(stops) if stops else None,
                     "clear_p50": percentile(clears, 50), "n": len(barge)},
        "terminal": {"placed": len(placed), "exactly_one": len(one)},
        "turn_timeouts": {"timeouts": timeouts, "caller_turns": caller_turns},
        "tools": {"passed": sum(1 for a in tool_checks if a["ok"]), "total": len(tool_checks)},
        "fidelity": {"wer_mean": round(sum(f["wer"] for f in fid) / len(fid), 3) if fid else None, "n": len(fid)},
        "cost": {"calls": len(costs), "minutes": round(total_min, 2), "inr": round(total_inr, 2),
                 "inr_per_call": round(total_inr / len(costs), 2) if costs else None,
                 "inr_per_min": round(total_inr / total_min, 2) if total_min else None,
                 "llm_measured": any(c["llm"].get("requests") and not c["llm"].get("estimated") for c in calls)},
    }


def write(out: Path, meta: dict[str, Any], results: list[ScenarioResult]) -> tuple[Path, Path]:
    kn = key_numbers(results)
    data = {"meta": meta, "key_numbers": kn, "scenarios": [s.__dict__ for s in results]}
    jp = out / "report.json"
    jp.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str))
    mp = out / "report.md"
    mp.write_text(markdown(meta, kn, results))
    return jp, mp


def markdown(meta: dict[str, Any], kn: dict[str, Any], results: list[ScenarioResult]) -> str:
    counts: dict[str, int] = {}
    for s in results:
        counts[s.status] = counts.get(s.status, 0) + 1
    mocked = meta.get("providers", "").count("mock") == 3
    L: list[str] = []
    L.append(f"# Voice E2E report, {meta['started']}")
    L.append("")
    L.append(f"- Mode: **{meta['mode']}** ({meta['providers']})")
    L.append(f"- voice-service at `{meta.get('commit', '?')}`, pipecat {meta.get('pipecat', '?')}, LLM model `{meta.get('llm_model')}`, "
             f"MAX_CONCURRENT_CALLS={meta.get('max_concurrent')}")
    L.append(f"- Ran {len(results)} scenarios in {meta.get('seconds', 0):.0f}s: "
             + ", ".join(f"{v} {k}" for k, v in sorted(counts.items())))
    if meta.get("claude"):
        L.append(f"- Claude: {meta['claude']}")
    L.append("")
    if mocked:
        L.append("> No-key run: Sarvam and Claude are replaced by mocks (an energy-segmenting STT that reports the caller's "
                 "scripted words, macOS `say` as TTS, and a keyword-driven brain). It proves voice-service's real pipeline, "
                 "turn-taking, barge-in, the Exotel protocol, tools plumbing, events and failure handling. It does not "
                 "measure Sarvam/Claude latency or conversation quality; latency here is voice-service's own floor "
                 "(VAD + turn detection + framework).")
        L.append("")
    L.append("## Key numbers")
    L.append("")
    lat, gr, bi, te, tl, fi, co = (kn[k] for k in ("latency", "greeting", "barge_in", "terminal", "tools", "fidelity", "cost"))
    L.append("| Metric | Value |")
    L.append("|---|---|")
    L.append(f"| Response latency, end of caller speech to first bot audio | p50 {_fmt(lat['p50'])}, p90 {_fmt(lat['p90'])} ({lat['n']} turns) |")
    L.append(f"| Time to first greeting (from the media stream opening) | p50 {_fmt(gr['p50'])}, p90 {_fmt(gr['p90'])} ({gr['n']} calls) |")
    L.append(f"| Barge-in: bot audio stopped after | p50 {_fmt(bi['stop_p50'])}, max {_fmt(bi['stop_max'])}; clear sent after p50 {_fmt(bi['clear_p50'])} ({bi['n']}) |")
    L.append(f"| Terminal events | {te['exactly_one']}/{te['placed']} placed calls had exactly one |")
    tt = kn["turn_timeouts"]
    L.append(f"| Smart Turn waited the full VOICE_TURN_MAX_WAIT_S (3 s) | {tt['timeouts']} of {tt['caller_turns']} caller turns "
             "(each adds about 3 s to that reply) |")
    L.append(f"| Tool-call checks | {tl['passed']}/{tl['total']} passed |")
    L.append(f"| Transcript fidelity (bot audio re-transcribed vs bot text) | "
             + (f"mean WER {fi['wer_mean']:.3f} ({fi['n']} calls) |" if fi["wer_mean"] is not None else "skipped: needs Sarvam STT (live run) |"))
    cost_note = ("measured Claude usage" if "LLM real" in meta.get("providers", "")
                 else "Claude tokens as the mock reports them (about request size / 4)")
    L.append(f"| Cost per call (STT + TTS + LLM, telephony excluded) | "
             + (f"Rs {co['inr_per_call']:.2f}/call, Rs {co['inr_per_min']:.2f}/min over {co['minutes']} min; {cost_note}"
                if co["inr_per_call"] is not None else "n/a") + (" (projected, providers mocked)" if mocked else "") + " |")
    L.append("")
    L.append("## Scenarios")
    L.append("")
    L.append("| Scenario | Group | Result | Latency p50/p90 | Greeting | Terminal | Notes |")
    L.append("|---|---|---|---|---|---|---|")
    for s in results:
        lats = [x["latency_s"] for c in s.calls for x in c["metrics"].get("response_latencies", [])]
        greets = [c["metrics"].get("time_to_first_greeting_s") for c in s.calls if c["metrics"].get("time_to_first_greeting_s") is not None]
        terms = ",".join(t["type"] for c in s.calls for t in c["terminal"]) or "-"
        failed = [a["name"] for a in s.assertions if not a["ok"]]
        note = s.reason or ("; ".join(failed)[:140] if failed else "")
        if s.plumbing_only and s.status in ("pass", "fail"):
            note = ("plumbing only (mocked brain). " + note).strip()
        L.append(f"| {s.name} | {s.group} | **{s.status.upper()}** | "
                 f"{_fmt(percentile(lats, 50))} / {_fmt(percentile(lats, 90))} | {_fmt(percentile(greets, 50))} | {terms} | {note} |")
    skipped = [s for s in results if s.status in ("skip", "blocked")]
    if skipped:
        L.append("")
        L.append("## Skipped or blocked")
        L.append("")
        for s in skipped:
            L.append(f"- **{s.name}** ({s.title}): {s.reason}")
    L.append("")
    L.append("## Details")
    for s in results:
        if s.status in ("skip",):
            continue
        L.append("")
        L.append(f"### {s.name}: {s.title} ({s.status.upper()})")
        L.append("")
        L.append(s.proves)
        L.append("")
        for a in s.assertions:
            mark = "PASS" if a["ok"] else "FAIL"
            detail = f" (`{a['detail'][:160]}`)" if a.get("detail") and not a["ok"] else ""
            L.append(f"- {mark}: {a['name']}{detail}")
        for c in s.calls:
            m = c["metrics"]
            lat_s = ", ".join(f"{x['latency_s']:.2f}" for x in m.get("response_latencies", [])) or "-"
            cost = m.get("cost") or {}
            L.append(f"- call `{c['callId']}`: {m.get('stream_s', 0)}s, closed by {m.get('closed_by') or '-'}, "
                     f"terminal {[t['type'] + (':' + t['reason'] if t.get('reason') else '') for t in c['terminal']]}, "
                     f"tools {[t['tool'] for t in c['tools']]}, latencies [{lat_s}], greeting {_fmt(m.get('time_to_first_greeting_s'))}, "
                     f"cost Rs {cost.get('total_inr', 0):.2f}" + (f", notes: {'; '.join(c['notes'])}" if c["notes"] else ""))
    L.append("")
    L.append("How to read this: docs/OUTREACH_E2E.md. Audio (stereo: left caller, right bot), the stub controller's "
             "request log and voice-service's log are next to this file.")
    return "\n".join(L) + "\n"
