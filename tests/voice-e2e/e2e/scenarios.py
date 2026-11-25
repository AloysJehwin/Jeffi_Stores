"""The scenarios: what each call does and what it must show.

`needs` names the real providers a scenario is meaningful with ("sarvam", "claude"); with none it runs on mocked
providers too (no keys), where it proves the pipeline, the protocol, the tools plumbing and the failure handling, not
the conversation quality.
"""

from __future__ import annotations

import asyncio
import re
import signal
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import websockets

from . import audio
from .harness import CallResult, Harness
from .phone import Turn
from .stub_controller import Fault

EN = {"owner": "Ramesh", "business": "Sri Lakshmi Sweets", "category": "sweet shop", "city": "Madurai"}
HI = {"owner": "Ramesh Sharma", "business": "Sharma Kirana Store", "category": "grocery store", "city": "Delhi"}
TA = {"owner": "Murugan", "business": "Murugan Textiles", "category": "saree shop", "city": "Kanchipuram"}

APOLOGY_EN = re.compile(r"line'?s breaking up|message you on whatsapp", re.I)
FILLER_EN = re.compile(r"\b(one moment|just a second)\b", re.I)
AI_DISCLOSURE = re.compile(r"\b(ai|a\.i\.|artificial|virtual assistant|automated|assistant)\b", re.I)
HUMAN_CLAIM = re.compile(r"\b(i am|i'm)\s+(a\s+)?(real\s+)?(human|person|not\s+an?\s+(ai|bot|robot))\b|\bnot\s+a\s+(bot|robot)\b", re.I)
PUBLISHED_SAY = re.compile(r"site is live|साइट अब लाइव|லைவ்", re.I)

Check = Callable[[Harness, list[CallResult]], list[dict[str, Any]]]


def ok(name: str, cond: bool, detail: Any = "") -> dict[str, Any]:
    return {"name": name, "ok": bool(cond), "detail": detail if isinstance(detail, str) else repr(detail)}


@dataclass
class Scenario:
    name: str
    group: str  # protocol | conversation | resilience | load
    title: str
    proves: str
    needs: frozenset[str] = frozenset()
    language: str = "en"
    contact: dict[str, str] = field(default_factory=lambda: dict(EN))
    turns: list[Turn] = field(default_factory=list)
    calls: int = 1
    answer: str = "answer"
    session: dict[str, Any] = field(default_factory=dict)
    max_s: float = 90.0
    post_terminal: bool = True
    terminal_wait_s: float = 40.0
    before: Callable[[Harness, str], Awaitable[Any]] | None = None
    after_place: Callable[[Harness, str, CallResult], Awaitable[Any]] | None = None
    hooks: dict[str, Callable[[Harness, str], Awaitable[Any]]] = field(default_factory=dict)
    check: Check | None = None
    custom: Callable[[Harness, Scenario], Awaitable[tuple[list[CallResult], list[dict[str, Any]]]]] | None = None
    budget_min: float = 1.5  # worst-case call minutes, for the spend cap
    end_wait_s: float = 10.0  # after its script, how long the caller waits in silence for the bot before hanging up
    plumbing_only_when_mocked: bool = False


# ── shared checks ──

def one_terminal(r: CallResult, *types: str) -> dict[str, Any]:
    got = [t.get("type") for t in r.terminal]
    return ok(f"exactly one terminal event ({'/'.join(types)})", len(got) == 1 and got[0] in types, got)


def bot_hung_up(r: CallResult) -> dict[str, Any]:
    return ok("the bot hung up (not the caller)", r.rec.closed_by == "bot", r.rec.closed_by)


def tools_in_order(r: CallResult, expected: list[str]) -> dict[str, Any]:
    got = r.tool_names()
    it = iter(got)
    return ok(f"tools called in order: {' > '.join(expected)}", all(e in it for e in expected), got)


def greeting_ok(r: CallResult, limit_s: float = 2.0) -> list[dict[str, Any]]:
    t = r.metrics.get("time_to_first_greeting_s")
    first = next((x for x in r.transcript if x.get("role") == "agent"), {})
    return [
        ok(f"greeting starts within {limit_s:.1f}s of the stream opening", t is not None and t <= limit_s, t),
        ok("greeting carries the recording notice", bool(re.search(r"recorded|रिकॉर्ड|பதிவு", str(first.get("text", "")))),
           str(first.get("text", ""))[:120]),
    ]


def speech_after(r: CallResult, t_rel: float, min_s: float = 0.3) -> float:
    """Seconds of bot speech the phone played after `t_rel`."""
    segs = audio.speech_segments(bytes(r.rec.bot))
    return round(sum(max(0.0, s.end - max(s.start, t_rel)) for s in segs if s.end > t_rel), 2)


def no_auth_failures(h: Harness) -> dict[str, Any]:
    return ok("every voice-service request carried a valid service token (service=voice, callId)",
              h.stub.auth_failures == 0, h.stub.auth_failures)


def say(text: str, label: str = "", **kw: Any) -> Turn:
    return Turn(text=text, label=label or text[:24], **kw)


# ── protocol ──

def check_protocol(h: Harness, rs: list[CallResult]) -> list[dict[str, Any]]:
    r = rs[0]
    f = r.rec.form
    types = [e.get("type") for e in r.events]
    term = r.terminal[0].get("data", {}) if r.terminal else {}
    greet = next(iter(audio.speech_segments(bytes(r.rec.bot), hangover_s=1.0)), None)
    in_greeting = [(c, d) for c, d in zip(r.rec.clears, r.rec.clear_dropped_s) if greet and greet.start <= c < greet.end]
    rec_file = h.recordings / str(term.get("recordingKey") or "missing")
    out = [
        ok("POST /calls -> 200 with providerCallId", r.place_status == 200 and bool(r.place_body.get("providerCallId")), r.place_body),
        ok("a repeated POST /calls for the same callId is idempotent (duplicate: true, same id)",
           r.marks.get("dup_ok", 0) == 1, r.marks.get("dup_body", "")),
        ok("Exotel connect form: From=lead, CallerId=ExoPhone, flow URL, timeouts, CustomField",
           f.get("From") == "+919000000001" and f.get("CallerId") == "+911400000000"
           and f.get("Url", "").endswith("/exoml/start_voice/e2e-app") and f.get("TimeOut") == "35"
           and f.get("TimeLimit") == "900" and f.get("CustomField") == r.call_id, {k: f.get(k) for k in ("From", "CallerId", "Url", "TimeOut", "TimeLimit")}),
        ok("status callback per call, JSON, answered + terminal events",
           f"/telephony/exotel/status/{r.call_id}?t=" in f.get("StatusCallback", "")
           and f.get("StatusCallbackEvents[0]") == "answered" and f.get("StatusCallbackEvents[1]") == "terminal"
           and f.get("StatusCallbackContentType") == "application/json", f.get("StatusCallback", "")[:80]),
        ok("events: ringing, answered, transcript batches, then the terminal one last",
           types[:2] == ["ringing", "answered"] and "transcript" in types and types[-1] == "ended", types),
        one_terminal(r, "ended"),
        ok("ended carries durationS from the provider, the transcript and the recording key",
           term.get("durationSource") == "provider" and isinstance(term.get("durationS"), int)
           and bool(term.get("transcript")) and bool(term.get("recordingKey")),
           {k: term.get(k) for k in ("durationS", "durationSource", "recordingKey")}),
        ok("recording stored at outreach/recordings/{callId}.mp3", rec_file.exists() and rec_file.stat().st_size > 0,
           term.get("recordingKey")),
        ok("talking over the greeting does not cut it (it keeps playing; a clear drops nothing)",
           greet is not None and all(d <= 0.2 and greet.end - c >= 1.0 for c, d in in_greeting),
           {"greeting": [round(greet.start, 2), round(greet.end, 2)] if greet else None, "clears_in_greeting": in_greeting}),
        ok("bot media frames are well-formed (base64 16-bit PCM, our stream_sid)", not r.rec.bad_messages and r.rec.bot_chunks > 0,
           {"bad": r.rec.bad_messages[:3], "chunk_sizes": sorted(r.rec.chunk_sizes)[:4]}),
        ok("caller hung up with a stop event; voice-service closed the call", r.rec.closed_by == "caller", r.rec.closed_by),
        no_auth_failures(h),
    ]
    return out + greeting_ok(r)


async def protocol_after_place(h: Harness, call_id: str, r: CallResult) -> None:
    status, body = await h.place(call_id, "en")
    r.marks["dup_ok"] = int(status == 200 and body.get("duplicate") is True and body.get("providerCallId") == r.place_body.get("providerCallId"))
    r.marks["dup_body"] = str(body)  # type: ignore[assignment]


async def ws_guard(h: Harness, sc: Scenario) -> tuple[list[CallResult], list[dict[str, Any]]]:
    base = f"ws://127.0.0.1:{h.ports['voice']}/ws/exotel"
    codes: dict[str, Any] = {}
    for name, url, call_sid in (("bad key", f"{base}?k=wrong", "x"), ("unknown call", f"{base}?k={h.ws_key}", "EXO-unknown")):
        try:
            async with websockets.connect(url, open_timeout=5) as ws:
                await ws.send('{"event":"connected"}')
                await ws.send('{"event":"start","sequence_number":1,"stream_sid":"s","start":{"stream_sid":"s","call_sid":"%s",'
                              '"account_sid":"a","from":"","to":"","custom_parameters":{},"media_format":{}}}' % call_sid)
                try:
                    await asyncio.wait_for(ws.recv(), 6)
                except websockets.ConnectionClosed:
                    pass
                codes[name] = ws.close_code
        except websockets.InvalidStatus as e:
            codes[name] = f"http {e.response.status_code}"
        except Exception as e:  # noqa: BLE001
            codes[name] = type(e).__name__
    return [], [
        ok("a media socket with the wrong ?k= is refused (1008)", codes.get("bad key") in (1008, "http 403"), codes.get("bad key")),
        ok("a media socket for an unknown call is refused (1008)", codes.get("unknown call") == 1008, codes.get("unknown call")),
    ]


def check_unanswered(kind: str) -> Check:
    def check(h: Harness, rs: list[CallResult]) -> list[dict[str, Any]]:
        r = rs[0]
        types = [e.get("type") for e in r.events]
        return [one_terminal(r, kind), ok("no answered event", "answered" not in types, types)]

    return check


# ── conversation ──

HAPPY = {
    "en": [
        say("Yes, this is Ramesh. I own Sri Lakshmi Sweets.", "owner"),
        say("Sure, you can send it on WhatsApp.", "consent"),
        say("We make traditional sweets and savouries, and we take orders for weddings. We're open from nine in the "
            "morning to nine at night, on Gandhi Road in Madurai.", "details"),
        say("Can you make the colours a bit warmer, more orange and gold?", "change"),
        say("Looks good. Please go ahead and publish it.", "publish"),
        say("Thank you, bye.", "bye"),
    ],
    "hi": [
        say("हाँ, मैं रमेश बोल रहा हूँ। मेरी दुकान का नाम शर्मा किराना स्टोर है।", "owner"),
        say("हाँ, आप WhatsApp पर भेज दीजिए।", "consent"),
        say("हम किराने का सामान, दालें और मसाले बेचते हैं। सुबह आठ बजे से रात दस बजे तक खुला रहता है, लाजपत नगर में।", "details"),
        say("रंग थोड़ा हरा कर दीजिए, और ऊपर होम डिलीवरी के बारे में लिख दीजिए।", "change"),
        say("अच्छा लग रहा है। इसे पब्लिश कर दीजिए।", "publish"),
        say("धन्यवाद, नमस्ते।", "bye"),
    ],
    "ta": [
        say("ஆமாம், நான் முருகன் பேசுகிறேன். என் கடையின் பெயர் முருகன் டெக்ஸ்டைல்ஸ்.", "owner"),
        say("சரி, WhatsApp-ல் அனுப்புங்கள்.", "consent"),
        say("நாங்கள் பட்டுப் புடவைகளும் காட்டன் துணிகளும் விற்கிறோம். காலை ஒன்பது மணி முதல் இரவு ஒன்பது மணி வரை "
            "திறந்திருக்கும், காஞ்சிபுரம் காந்தி ரோட்டில்.", "details"),
        say("நிறத்தை கொஞ்சம் மெரூன் ஆக மாற்றுங்கள்.", "change"),
        say("நன்றாக இருக்கிறது. பப்ளிஷ் செய்யுங்கள்.", "publish"),
        say("நன்றி, வணக்கம்.", "bye"),
    ],
}


def check_happy(name_pattern: str) -> Check:
    def check(h: Harness, rs: list[CallResult]) -> list[dict[str, Any]]:
        r = rs[0]
        names = r.tool_names()
        start = next((t for t in r.tools if t["tool"] == "startPreview"), None)
        publish = next((t for t in r.tools if t["tool"] == "publishSite"), None)
        publish_utt = next((u for u in r.rec.utterances if u.label == "publish"), None)
        consent_i = names.index("recordConsent") if "recordConsent" in names else 99
        preview_i = names.index("startPreview") if "startPreview" in names else -1
        return [
            tools_in_order(r, ["startPreview", "addDetails", "requestChange", "publishSite"]),
            ok("consent recorded before the preview (WhatsApp needs consent)", 0 <= consent_i < preview_i, names),
            ok("startPreview got the business name", bool(start and re.search(name_pattern, str((start.get("args") or {}).get("business_name", "")), re.I)),
               (start or {}).get("args")),
            ok("publishSite only after the caller asked to publish",
               bool(publish and publish_utt and publish["at"] is not None and publish["at"] >= publish_utt.sent_start),
               {"publish_at": (publish or {}).get("at"), "asked_at": publish_utt.sent_start if publish_utt else None}),
            ok("the controller's publish line was spoken", bool(PUBLISHED_SAY.search(r.agent_text())), r.agent_text()[-160:]),
            one_terminal(r, "ended"),
            *greeting_ok(r),
            no_auth_failures(h),
        ]

    return check


def check_barge(h: Harness, rs: list[CallResult]) -> list[dict[str, Any]]:
    r = rs[0]
    b = (r.metrics.get("barge_ins") or [{}])[0]
    return [
        ok("the caller cut in while the bot was talking", bool(b.get("bot_was_speaking")), b),
        ok("voice-service sent clear within 1.0 s of the caller starting", b.get("clear_s") is not None and b["clear_s"] <= 1.0, b.get("clear_s")),
        ok("the bot's audio stopped within 1.2 s", b.get("stop_s") is not None and b["stop_s"] <= 1.2, b.get("stop_s")),
        ok("the bot answered the new question after the interruption", len(r.rec.bot_onsets) >= 4, r.rec.bot_onsets),
        one_terminal(r, "ended"),
    ]


def check_silence(h: Harness, rs: list[CallResult]) -> list[dict[str, Any]]:
    r = rs[0]
    segs = audio.speech_segments(bytes(r.rec.bot), hangover_s=0.6)
    gap = round(segs[1].start - segs[0].end, 2) if len(segs) >= 2 else None
    silence_s = 6.0
    return [
        ok("greeting, then a check-in, then a goodbye (3+ bot utterances)", len(segs) >= 3, [round(s.start, 1) for s in segs]),
        ok(f"check-in after about {silence_s:.0f}s of silence (+-3s)", gap is not None and abs(gap - silence_s) <= 3.0, gap),
        bot_hung_up(r),
        ok("the call ended within 40 s", (r.rec.closed_at or 99) <= 40, r.rec.closed_at),
        one_terminal(r, "ended"),
    ]


def check_voicemail(max_s: float) -> Check:
    def check(h: Harness, rs: list[CallResult]) -> list[dict[str, Any]]:
        r = rs[0]
        return [
            one_terminal(r, "voicemail"),
            ok(f"cut within {max_s:.1f}s of answer", r.rec.closed_at is not None and r.rec.closed_at <= max_s, r.rec.closed_at),
            bot_hung_up(r),
            ok("no message left and no tools called", not r.tools, r.tool_names()),
        ]

    return check


def check_bot_question(h: Harness, rs: list[CallResult]) -> list[dict[str, Any]]:
    r = rs[0]
    q = next((u for u in r.rec.utterances if u.label == "are you a bot"), None)
    after = " ".join(r.agent_turns_after(q.speech_end if q else 0.0))
    return [
        ok("asked if it is a bot, it says it is an AI assistant", bool(AI_DISCLOSURE.search(after)), after[:200]),
        ok("it never claims to be human", not HUMAN_CLAIM.search(r.agent_text()), (HUMAN_CLAIM.search(r.agent_text()) or [""])[0]),
        one_terminal(r, "ended"),
    ]


def check_stop(h: Harness, rs: list[CallResult]) -> list[dict[str, Any]]:
    r = rs[0]
    names = r.tool_names()
    stop = next((u for u in r.rec.utterances if u.label == "stop"), None)
    return [
        ok("optOut called, and nothing after it", bool(names) and names[-1] == "optOut", names),
        bot_hung_up(r),
        ok("hung up within 12 s of 'stop'", bool(stop and r.rec.closed_at and r.rec.closed_at - stop.speech_end <= 12),
           round((r.rec.closed_at or 0) - (stop.speech_end if stop else 0), 2)),
        ok("no pitching after stop: at most the goodbye line", len([o for o in r.rec.bot_onsets if stop and o > stop.speech_end]) <= 2,
           [o for o in r.rec.bot_onsets if stop and o > stop.speech_end]),
        one_terminal(r, "ended"),
    ]


def check_switch(h: Harness, rs: list[CallResult]) -> list[dict[str, Any]]:
    r = rs[0]
    sw = next((t for t in r.tools if t["tool"] == "switchLanguage"), None)
    term = r.terminal[0].get("data", {}) if r.terminal else {}
    return [
        ok("switchLanguage called with ta", bool(sw and (sw.get("args") or {}).get("language") == "ta"), (sw or {}).get("args")),
        ok("ended carries redialLanguage=ta (the controller rings back in Tamil)", term.get("redialLanguage") == "ta", term.get("redialLanguage")),
        bot_hung_up(r),
        one_terminal(r, "ended"),
    ]


# ── load ──

async def concurrent(h: Harness, sc: Scenario) -> tuple[list[CallResult], list[dict[str, Any]]]:
    async def one(i: int) -> CallResult:
        await asyncio.sleep(0.25 * i)
        turns = [say("Hello? Who's calling?", "who"), say("Okay, not interested, thanks. Bye.", "bye")]
        for t in turns:
            t.pcm = h.caller_audio(t.text, "en") or b""
        return await h.run_call(name=sc.name, idx=i, language="en", contact=EN, turns=turns, session=sc.session,
                                max_s=sc.max_s, terminal_wait_s=sc.terminal_wait_s)

    tasks = [asyncio.ensure_future(one(i)) for i in range(sc.calls)]
    extra: dict[str, Any] = {}
    if sc.calls >= h.max_concurrent:
        await asyncio.sleep(0.25 * sc.calls + 1.5)
        status, body = await h.place(f"e2e-{sc.name}-overflow", "en")
        extra = {"status": status, "body": body}
    rs = list(await asyncio.gather(*tasks))
    lat = [x["latency_s"] for r in rs for x in r.metrics.get("response_latencies", [])]
    greet = [r.metrics.get("time_to_first_greeting_s") for r in rs]
    from .metrics import percentile

    checks = [
        ok(f"all {sc.calls} calls answered and ended with exactly one terminal event",
           all(len(r.terminal) == 1 and r.terminal[0].get("type") == "ended" for r in rs), [r.metrics.get("terminal_types") for r in rs]),
        ok("every greeting started within 2.5 s", all(g is not None and g <= 2.5 for g in greet), greet),
        ok("every caller turn got a reply", not [n for r in rs for n in r.rec.notes if "no bot reply" in n],
           [n for r in rs for n in r.rec.notes][:3]),
        ok("response latency p50 under 2.5 s while concurrent (p90 is dominated by Smart Turn waits)",
           (percentile(lat, 50) or 99) < 2.5, {"p50": percentile(lat, 50), "p90": percentile(lat, 90),
                                               "turn_timeouts": sum(r.metrics.get("turn_timeouts") or 0 for r in rs)}),
        no_auth_failures(h),
    ]
    if extra:
        checks.append(ok(f"call {h.max_concurrent + 1} is refused with 429 at MAX_CONCURRENT_CALLS={h.max_concurrent}",
                         extra["status"] == 429, extra))
    return rs, checks


# ── resilience ──

def arm(kind: str) -> Callable[[Harness, str], Awaitable[Any]]:
    async def hook(h: Harness, call_id: str) -> None:
        await h.fault(call_id, kind)

    return hook


def check_fault(kind: str, apology: bool, reasons: tuple[str, ...] = ()) -> Check:
    def check(h: Harness, rs: list[CallResult]) -> list[dict[str, Any]]:
        r = rs[0]
        t_arm = r.marks.get("arm", 0.0)
        term = r.terminal[0].get("data", {}) if r.terminal else {}
        out = [one_terminal(r, "error")]
        if reasons:
            out.append(ok(f"reason is one of {', '.join(reasons)}", term.get("reason") in reasons, term.get("reason")))
        else:
            out.append(ok("reason reported", bool(term.get("reason")), term.get("reason")))
        spoken = speech_after(r, t_arm + 0.5)
        if apology:
            out.append(ok("apologised ('the line's breaking up...')", bool(APOLOGY_EN.search(" ".join(r.agent_turns_after(t_arm)))) and spoken > 0.5,
                          {"speech_after_fault_s": spoken, "agent": r.agent_turns_after(t_arm)[-2:]}))
        else:
            out.append(ok("no speech after the fault (TTS is what broke: hang up straight away)", spoken < 1.0, spoken))
        out.append(bot_hung_up(r))
        out.append(ok("ended within 25 s of the fault", r.rec.closed_at is not None and r.rec.closed_at - t_arm <= 25,
                      round((r.rec.closed_at or 0) - t_arm, 2)))
        return out

    return check


FAULT_TURNS = [say("Yes, this is Ramesh. I own Sri Lakshmi Sweets.", "owner"),
               say("Sure, you can send it on WhatsApp.", "consent", hook="arm", max_wait_s=30)]


def fault_scenario(name: str, kind: str, title: str, proves: str, apology: bool, reasons: tuple[str, ...] = ()) -> Scenario:
    # A patient caller (30 s of silence) so the bot's own watchdogs, not the caller, end the call.
    return Scenario(name, "resilience", title, proves, turns=[*FAULT_TURNS], hooks={"arm": arm(kind)},
                    check=check_fault(kind, apology, reasons), max_s=90, budget_min=1.5, end_wait_s=30.0)


async def session_down(h: Harness, call_id: str) -> None:
    h.controller_fault(call_id, Fault(("session",), down=True))


def check_session_down(h: Harness, rs: list[CallResult]) -> list[dict[str, Any]]:
    r = rs[0]
    term = r.terminal[0].get("data", {}) if r.terminal else {}
    return [
        one_terminal(r, "error"),
        ok("reason session_unavailable", term.get("reason") == "session_unavailable", term.get("reason")),
        ok("apologised in audio, then hung up", speech_after(r, 0.0) > 0.8 and r.rec.closed_by == "bot",
           {"speech_s": speech_after(r, 0.0), "closed_by": r.rec.closed_by}),
    ]


async def tools_slow(h: Harness, call_id: str) -> None:
    h.controller_fault(call_id, Fault(("tools",), delay_s=4.0))


def check_tools_slow(h: Harness, rs: list[CallResult]) -> list[dict[str, Any]]:
    r = rs[0]
    return [
        ok("a filler ('one moment') covered the slow tool", bool(FILLER_EN.search(r.agent_text())), r.agent_text()[-200:]),
        ok("the slow tool still succeeded", any(t["tool"] == "recordConsent" and t["status"] == 200 for t in r.tools), r.tool_names()),
        one_terminal(r, "ended"),
    ]


async def controller_outage(h: Harness, call_id: str) -> None:
    h.controller_fault(call_id, Fault(("tools", "events"), down=True, until=time.time() + 8))


def check_outage(h: Harness, rs: list[CallResult]) -> list[dict[str, Any]]:
    r = rs[0]
    failed = [t for t in r.tools if t["status"] == 503]
    t_arm = r.marks.get("arm", 0.0)
    after = " ".join(r.agent_turns_after(t_arm))
    return [
        ok("the tool call hit the outage (503)", bool(failed), [t["tool"] for t in failed]),
        ok("no false success after the failed tool", not re.search(r"started your site|i've added|updated it|site is live", after, re.I), after[:200]),
        one_terminal(r, "ended", "error"),
        ok("the terminal event was delivered once the controller came back", bool(r.terminal), len(r.terminal)),
    ]


def check_drop(with_status: bool) -> Check:
    def check(h: Harness, rs: list[CallResult]) -> list[dict[str, Any]]:
        r = rs[0]
        term = r.terminal[0] if r.terminal else {}
        data = term.get("data", {})
        delay = round(term.get("_t", 0) - (r.rec.e0 + (r.rec.closed_at or 0)), 1) if term else None
        out = [one_terminal(r, "ended")]
        if with_status:
            out.append(ok("reported within 10 s of the drop, provider duration", delay is not None and delay <= 10
                          and data.get("durationSource") == "provider", {"delay_s": delay, "source": data.get("durationSource")}))
        else:
            out.append(ok("no provider status: reported after the 30 s grace with providerStatus=missing",
                          data.get("providerStatus") == "missing" and data.get("durationSource") == "local" and (delay or 0) >= 25,
                          {"delay_s": delay, "providerStatus": data.get("providerStatus")}))
        return out

    return check


async def sigterm(h: Harness, call_id: str) -> None:
    if h.proc is not None:
        h.proc.send_signal(signal.SIGTERM)


async def sigkill(h: Harness, call_id: str) -> None:
    if h.proc is not None:
        h.proc.send_signal(signal.SIGKILL)


async def restart(h: Harness, sc: Scenario, sig: str) -> tuple[list[CallResult], list[dict[str, Any]]]:
    turns = [say("Yes, this is Ramesh. I own Sri Lakshmi Sweets.", "owner"),
             say("Can you explain in detail what this website includes?", "ask"),
             Turn(kind="silence", when="barge", after_s=1.5, hook="kill", label="kill")]
    for t in turns:
        t.pcm = h.caller_audio(t.text, "en") or b"" if t.text else b""
    res = await h.run_call(name=sc.name, idx=0, language="en", contact=EN, turns=turns, session={}, max_s=60,
                           terminal_wait_s=8 if sig == "kill" else 30, hooks={"kill": sigterm if sig == "term" else sigkill})
    await h.stop_voice()  # make sure the old process is gone
    before_restart = len(h.stub.terminal_events(res.call_id))
    await h.start_voice()
    h.restarts += 1
    await h.await_terminal(res, 15, settle_s=4.0)
    await h.collect(res)
    term = res.terminal[0].get("data", {}) if res.terminal else {}
    checks = [
        one_terminal(res, "error"),
        ok("reason restart", term.get("reason") == "restart", term.get("reason")),
        ok("the restarted process did not report it again" if sig == "term" else "the restarted process reported the orphan",
           (before_restart == 1 and len(res.terminal) == 1) if sig == "term" else (before_restart == 0 and len(res.terminal) == 1),
           {"before_restart": before_restart, "after": len(res.terminal)}),
    ]
    return [res], checks


# ── the list ──

def all_scenarios() -> list[Scenario]:
    return [
        Scenario("protocol", "protocol", "Exotel protocol, events and greeting",
                 "The AgentStream handshake, media framing, the Exotel REST form, status callbacks, the event sequence "
                 "with exactly one terminal event, idempotent placing, the recording notice and gate, service-token auth.",
                 turns=[say("Hello? Hello?", "over greeting", when="greeting", after_s=1.0),
                        say("Who is this?", "who"), Turn(kind="hangup", label="hang up", gap_s=1.0)],
                 after_place=protocol_after_place, check=check_protocol, max_s=60),
        Scenario("protocol_ws_guard", "protocol", "Media socket guard",
                 "Sockets with a wrong key or for a call voice-service did not place are refused.", custom=ws_guard, budget_min=0),
        Scenario("no_answer", "protocol", "Not answered", "A ring with no answer ends with one no_answer event.",
                 answer="no-answer", check=check_unanswered("no_answer"), max_s=20, budget_min=0.2),
        Scenario("busy", "protocol", "Busy", "A busy line ends with one busy event.", answer="busy",
                 check=check_unanswered("busy"), max_s=20, budget_min=0.2),
        Scenario("happy_en", "conversation", "Happy path, English",
                 "Owner confirmed, consent, preview, details, a change, publish, goodbye: the tools in order and the "
                 "controller's lines spoken.", turns=[*HAPPY["en"]], check=check_happy(r"lakshmi"), max_s=180,
                 budget_min=3.0, plumbing_only_when_mocked=True),
        Scenario("happy_hi", "conversation", "Happy path, Hindi", "The same flow in Hindi.", needs=frozenset({"sarvam", "claude"}),
                 language="hi", contact=dict(HI), turns=[*HAPPY["hi"]], check=check_happy(r"sharma|शर्मा"), max_s=180, budget_min=3.0),
        Scenario("happy_ta", "conversation", "Happy path, Tamil", "The same flow in Tamil.", needs=frozenset({"sarvam", "claude"}),
                 language="ta", contact=dict(TA), turns=[*HAPPY["ta"]], check=check_happy(r"murugan|முருகன்"), max_s=180, budget_min=3.0),
        Scenario("barge_in", "conversation", "Barge-in", "The caller cuts in mid-sentence: clear goes out, the bot stops "
                 "fast and answers the new question.",
                 turns=[say("Hi, yes, this is Ramesh.", "hi"), say("Can you explain in detail what this website includes?", "ask"),
                        say("Sorry, sorry, one second. How much does it cost?", "barge", when="barge", after_s=2.0),
                        say("Okay, not interested right now, thanks. Bye.", "bye")],
                 check=check_barge, max_s=90, budget_min=1.5, plumbing_only_when_mocked=True),
        Scenario("silence", "conversation", "Long silence", "Nobody speaks: a check-in after silenceS, then a goodbye "
                 "and the bot hangs up.", turns=[Turn(kind="silence", when="now", after_s=50, label="silent")],
                 session={"silenceS": 6}, check=check_silence, max_s=60, budget_min=1.0),
        Scenario("voicemail", "conversation", "Voicemail (greeting + beep)", "A voicemail greeting then a beep ends the "
                 "call as voicemail inside the 8 s window, leaving no message.",
                 turns=[Turn(kind="audio", when="now", after_s=0.3, label="voicemail",
                             text="Hi, you've reached Ramesh at Sri Lakshmi Sweets. I can't take your call right now. "
                                  "Please leave a message after the beep.")],
                 check=check_voicemail(9.5), max_s=30, budget_min=0.5),
        Scenario("voicemail_beep", "conversation", "Voicemail (beep only)", "A bare beep (no words) is caught by the tone "
                 "detector alone.", turns=[Turn(kind="beep", when="now", after_s=1.0, label="beep")],
                 check=check_voicemail(6.0), max_s=30, budget_min=0.5),
        Scenario("bot_question", "conversation", "\"Are you a bot?\"", "Asked sincerely, it says it is Jeffi Stores' AI "
                 "assistant and never claims to be human.", needs=frozenset({"claude"}),
                 turns=[say("Yes, speaking. Who is this?", "who"), say("Wait, am I talking to a real person or a robot?", "are you a bot"),
                        say("Okay. And honestly, are you a human?", "human?"), say("Alright, I'm not interested. Bye.", "bye")],
                 check=check_bot_question, max_s=120, budget_min=2.0),
        Scenario("stop", "conversation", "STOP / don't call", "'Don't call me' is honoured at once: optOut, a short "
                 "goodbye, hang up, no pitch.", turns=[say("Yes?", "yes"), say("Please stop calling me. Don't call this number again.", "stop")],
                 check=check_stop, max_s=60, budget_min=1.0, plumbing_only_when_mocked=True),
        Scenario("language_switch", "conversation", "Language switch", "Asked for Tamil: switchLanguage, then ended "
                 "carries redialLanguage=ta.", turns=[say("Yes, this is Ramesh.", "yes"),
                                                      say("Can we talk in Tamil please? I'm more comfortable in Tamil.", "tamil")],
                 check=check_switch, max_s=60, budget_min=1.0, plumbing_only_when_mocked=True),
        Scenario("concurrent_2", "load", "Two concurrent calls", "Two calls at once: each greets fast, replies on time and "
                 "ends with one terminal event.", calls=2, custom=concurrent, max_s=60, budget_min=2.0),
        Scenario("concurrent_5", "load", "Five concurrent calls", "Five at once (MAX_CONCURRENT_CALLS=5 here), and a sixth "
                 "refused with 429.", calls=5, custom=concurrent, max_s=60, budget_min=5.0),
        fault_scenario("fault_stt_5xx", "stt_5xx", "Sarvam STT 5xx mid-call",
                       "STT starts failing mid-call: apology, hang-up, one error event.", True),
        fault_scenario("fault_stt_timeout", "stt_timeout", "Sarvam STT stops answering",
                       "STT goes silent mid-call: apology, hang-up, one error event.", True),
        fault_scenario("fault_tts_5xx", "tts_5xx", "Sarvam TTS 5xx mid-call",
                       "TTS fails mid-call: nothing can be said, so hang up at once, one error event.", False),
        fault_scenario("fault_tts_timeout", "tts_timeout", "Sarvam TTS stops answering",
                       "TTS goes silent mid-call: hang up, one error event.", False),
        fault_scenario("fault_llm_5xx", "llm_5xx", "Claude 5xx mid-call",
                       "Claude errors (after the SDK's retries): apology, hang-up, one error event.", True),
        fault_scenario("fault_llm_timeout", "llm_timeout", "Claude never answers",
                       "Claude hangs: the 9 s no-reply watchdog apologises and hangs up, one error event.", True),
        Scenario("fault_session_down", "resilience", "Controller down at answer",
                 "The session can't be fetched: the apology in the default voice, hang up, error session_unavailable.",
                 turns=[say("Hello?", "hello", when="now", after_s=0.5)], before=session_down, check=check_session_down,
                 max_s=40, budget_min=0.5),
        Scenario("fault_tools_slow", "resilience", "Controller slow (tools 4 s)",
                 "A slow tool is covered by a filler and still succeeds.", before=tools_slow,
                 turns=[say("Yes, this is Ramesh. I own Sri Lakshmi Sweets.", "owner"), say("Sure, you can send it on WhatsApp.", "consent"),
                        say("Okay, not interested, thanks. Bye.", "bye")], check=check_tools_slow, max_s=90, budget_min=1.5),
        Scenario("fault_controller_outage", "resilience", "Controller down mid-call (8 s)",
                 "Tools fail during an outage without a false claim of success; the terminal event still lands once it is back.",
                 turns=[say("Yes, this is Ramesh. I own Sri Lakshmi Sweets.", "owner"),
                        say("Sure, you can send it on WhatsApp.", "consent", hook="arm"), say("Okay. Bye.", "bye")],
                 hooks={"arm": controller_outage}, check=check_outage, max_s=90, budget_min=1.5),
        Scenario("fault_ws_drop", "resilience", "Media socket dropped mid-call",
                 "The line drops while the bot talks: one ended event once Exotel reports the end.",
                 turns=[say("Yes, this is Ramesh. I own Sri Lakshmi Sweets.", "owner"), Turn(kind="drop", when="barge", after_s=1.0, label="drop")],
                 check=check_drop(True), max_s=60, budget_min=1.0),
        Scenario("fault_ws_drop_no_status", "resilience", "Socket dropped, provider never reports",
                 "No terminal callback from Exotel: the event still goes out after the 30 s grace (providerStatus=missing).",
                 turns=[say("Yes, this is Ramesh. I own Sri Lakshmi Sweets.", "owner"), Turn(kind="drop", when="barge", after_s=1.0, label="drop")],
                 post_terminal=False, terminal_wait_s=45, check=check_drop(False), max_s=60, budget_min=1.0),
        Scenario("fault_restart", "resilience", "voice-service restart (SIGTERM) mid-call",
                 "A rolling restart ends live calls with one error event (reason restart), never two.",
                 custom=lambda h, sc: restart(h, sc, "term"), budget_min=1.0),
        Scenario("fault_crash", "resilience", "voice-service crash (SIGKILL) mid-call",
                 "After a crash, the next process reports the orphaned call once (error, restart).",
                 custom=lambda h, sc: restart(h, sc, "kill"), budget_min=1.0),
    ]


def by_name() -> dict[str, Scenario]:
    return {s.name: s for s in all_scenarios()}
