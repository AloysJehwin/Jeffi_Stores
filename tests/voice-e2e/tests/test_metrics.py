from __future__ import annotations

from e2e import audio, metrics
from e2e.phone import CallRecord, Utterance


def test_percentile() -> None:
    assert metrics.percentile([], 50) is None
    assert metrics.percentile([2.0], 90) == 2.0
    assert metrics.percentile([1.0, 2.0, 3.0, 4.0], 50) == 2.5
    assert abs(metrics.percentile([1.0, 2.0, 3.0, 4.0, 5.0], 90) - 4.6) < 1e-9


def test_wer_and_cer() -> None:
    assert metrics.wer("Hello, there! How are you?", "hello there how are you") == 0.0
    assert metrics.wer("one two three four", "one two four") == 0.25
    assert metrics.wer("", "x") is None
    assert metrics.cer("नमस्ते", "नमस्ते।") == 0.0
    assert metrics.cer("abcd", "abed") == 0.25


def _rec(bot: bytes, utts: list[Utterance], onsets: list[float], clears: list[float] | None = None) -> CallRecord:
    r = CallRecord(call_id="c")
    r.bot = bytearray(bot)
    r.utterances = utts
    r.bot_onsets = onsets
    r.clears = clears or []
    return r


def test_response_latency_skips_barge_ins() -> None:
    utts = [Utterance("a", "hi", 3.0, 3.1, 4.0), Utterance("b", "stop", 6.0, 6.1, 7.0, barge=True),
            Utterance("c", "bye", 9.0, 9.1, 10.0)]
    r = _rec(b"", utts, onsets=[1.0, 4.8, 5.5, 11.2])
    assert metrics.response_latencies(r) == [{"after": "a", "latency_s": 0.8}, {"after": "c", "latency_s": 1.2}]


def test_barge_in_stop_time() -> None:
    bot = audio.silence(1.0) + audio.beep(2.0, amp=0.3) + audio.silence(1.0)
    utts = [Utterance("b", "wait", 1.4, 1.5, 2.5, barge=True)]
    r = _rec(bot, utts, onsets=[1.0], clears=[1.8])
    b = metrics.barge_ins(r)[0]
    assert b["bot_was_speaking"] and abs(b["stop_s"] - 1.5) < 0.05 and b["clear_s"] == 0.3


def test_cost_uses_rates() -> None:
    c = metrics.cost(120.0, 1000, {"requests": 3, "input_tokens": 1_000_000, "output_tokens": 0})
    assert c["minutes"] == 2.0 and c["stt_inr"] == 1.0 and c["tts_inr"] == 1.5
    assert c["llm_inr"] == round(0.10 * 88.0, 4)
    assert metrics.cost(60.0, 0, None)["llm_inr"] is None


def test_agent_text() -> None:
    assert metrics.agent_text([{"role": "agent", "text": "a"}, {"role": "user", "text": "b"}, {"role": "agent", "text": "c"}]) == "a c"
