"""Per-call numbers from what the simulated phone heard and what the stub controller received."""

from __future__ import annotations

import math
import re
import unicodedata
from typing import Any

from .audio import RATE, speech_segments
from .config import RATES, Rates
from .phone import CallRecord


def percentile(values: list[float], q: float) -> float | None:
    """Linear-interpolated percentile (q in 0..100); None for no values."""
    xs = sorted(v for v in values if v is not None and not math.isnan(v))
    if not xs:
        return None
    if len(xs) == 1:
        return xs[0]
    k = (len(xs) - 1) * q / 100.0
    lo, hi = math.floor(k), math.ceil(k)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def time_to_greeting(rec: CallRecord) -> float | None:
    return rec.bot_onsets[0] if rec.bot_onsets else None


def response_latencies(rec: CallRecord) -> list[dict[str, Any]]:
    """End of each caller utterance -> the first bot audio after it (barge-ins and over-greeting talk excluded)."""
    out = []
    utts = rec.utterances
    for i, u in enumerate(utts):
        if u.barge or not u.text:
            continue
        nxt = utts[i + 1].sent_start if i + 1 < len(utts) else float("inf")
        onset = next((o for o in rec.bot_onsets if u.speech_end <= o < nxt), None)
        if onset is not None:
            out.append({"after": u.label, "latency_s": round(onset - u.speech_end, 3)})
    return out


def barge_ins(rec: CallRecord) -> list[dict[str, Any]]:
    """For each barge-in: how long the bot kept talking after the caller started, and when `clear` arrived."""
    segs = speech_segments(bytes(rec.bot), RATE, hangover_s=0.15)
    out = []
    for u in rec.utterances:
        if not u.barge:
            continue
        s = u.speech_start
        seg = next((g for g in segs if g.start - 0.05 <= s < g.end), None)
        clear = next((c for c in rec.clears if c >= s - 0.05), None)
        out.append({
            "label": u.label,
            "bot_was_speaking": seg is not None,
            "stop_s": round(seg.end - s, 3) if seg is not None else None,
            "clear_s": round(clear - s, 3) if clear is not None else None,
        })
    return out


_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)


def normalize(text: str) -> list[str]:
    t = unicodedata.normalize("NFC", text).lower()
    t = "".join(ch for ch in t if not unicodedata.category(ch).startswith("P"))
    return _PUNCT.sub(" ", t).split()


def _edits(a: list[str], b: list[str]) -> int:
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, y in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y))
        prev = cur
    return prev[-1]


def wer(reference: str, hypothesis: str) -> float | None:
    ref, hyp = normalize(reference), normalize(hypothesis)
    if not ref:
        return None
    return round(_edits(ref, hyp) / len(ref), 3)


def cer(reference: str, hypothesis: str) -> float | None:
    ref, hyp = list("".join(normalize(reference))), list("".join(normalize(hypothesis)))
    if not ref:
        return None
    return round(_edits(ref, hyp) / len(ref), 3)


def agent_text(transcript: list[dict[str, Any]]) -> str:
    return " ".join(str(t.get("text", "")) for t in transcript if t.get("role") == "agent")


def cost(stream_s: float, agent_chars: int, llm: dict[str, Any] | None, rates: Rates = RATES) -> dict[str, Any]:
    """Rupees. STT bills the caller's streamed audio for the whole connected time; TTS the spoken characters."""
    minutes = stream_s / 60.0
    stt = minutes * rates.stt_inr_per_min
    tts = agent_chars / 1000.0 * rates.tts_inr_per_1k_chars
    llm_inr = None
    if llm and llm.get("requests"):
        usd = (llm.get("input_tokens", 0) * rates.llm_in_usd_per_mtok
               + llm.get("cache_creation_input_tokens", 0) * rates.llm_in_usd_per_mtok * rates.llm_cache_write_mult
               + llm.get("cache_read_input_tokens", 0) * rates.llm_in_usd_per_mtok * rates.llm_cache_read_mult
               + llm.get("output_tokens", 0) * rates.llm_out_usd_per_mtok) / 1_000_000
        llm_inr = usd * rates.usd_inr
    total = stt + tts + (llm_inr or 0.0)
    return {
        "minutes": round(minutes, 3),
        "stt_inr": round(stt, 3),
        "tts_inr": round(tts, 3),
        "llm_inr": round(llm_inr, 4) if llm_inr is not None else None,
        "total_inr": round(total, 3),
        "per_min_inr": round(total / minutes, 3) if minutes > 0 else None,
        "telephony_inr_not_included": round(minutes * rates.telephony_inr_per_min, 3),
    }
