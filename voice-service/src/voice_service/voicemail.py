"""Voicemail / IVR detection from the first seconds after answer, as pure heuristics.

Signals: a beep (a sustained pure tone), a long unbroken monologue (people say "hello?" and wait), and the
phrases of voicemail greetings, operator announcements and IVR menus, in English and the Indian languages we call in.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum

import numpy as np


class Verdict(StrEnum):
    HUMAN = "human"
    MACHINE = "machine"
    UNKNOWN = "unknown"


# Lower-cased substrings. Only phrases a person answering the phone wouldn't say ("he's not available" or "I'm
# busy" are human, so they are not here). Romanised forms cover code-mixed STT output.
MACHINE_PHRASES: tuple[str, ...] = (
    # voicemail
    "voicemail", "voice mail", "leave a message", "leave your message", "after the beep", "after the tone",
    "record your message", "at the tone", "mailbox",
    # operator announcements
    "is not reachable", "not reachable", "switched off", "please try again later", "the number you have dialled",
    "the number you have dialed", "the subscriber you", "does not exist", "out of coverage", "call forwarding",
    # IVR menus
    "press 1", "press one", "press 2", "press two", "press zero", "press star", "press hash", "dial 1",
    "for english", "main menu", "your call is important",
    # Hindi
    "स्विच ऑफ", "पहुंच से बाहर", "संदेश छोड़", "बीप के बाद", "दबाएं", "दबाइए", "हिंदी के लिए", "आप जिस नंबर",
    "switch off hai", "pahunch se bahar", "dabaye", "beep ke baad",
    # "press" in Tamil, Telugu, Kannada, Malayalam, Marathi, Bengali, Gujarati
    "அழுத்தவும்", "నొక్కండి", "ಒತ್ತಿ", "അമർത്തുക", "दाबा", "টিপুন", "દબાવો",
)

_SPACES = re.compile(r"\s+")


def phrase_hit(text: str) -> str | None:
    t = _SPACES.sub(" ", text.lower())
    for p in MACHINE_PHRASES:
        if p in t:
            return p
    return None


def is_beep(samples: np.ndarray, sample_rate: int, min_freq: float = 400.0, max_freq: float = 2500.0) -> bool:
    """True for a loud, narrowband tone (most of the energy in one frequency) in the beep range.

    `samples` is int16 or float mono audio, ideally 100-300 ms long.
    """
    if samples.size < sample_rate // 20:
        return False
    x = samples.astype(np.float64)
    if samples.dtype == np.int16:
        x /= 32768.0
    x = x - x.mean()
    rms = float(np.sqrt(np.mean(x * x)))
    if rms < 0.02:
        return False
    spec = np.abs(np.fft.rfft(x * np.hanning(x.size))) ** 2
    freqs = np.fft.rfftfreq(x.size, 1.0 / sample_rate)
    total = float(spec.sum())
    if total <= 0:
        return False
    peak = int(np.argmax(spec))
    if not (min_freq <= freqs[peak] <= max_freq):
        return False
    # Energy within +-40 Hz of the peak.
    band = (freqs >= freqs[peak] - 40) & (freqs <= freqs[peak] + 40)
    return float(spec[band].sum()) / total >= 0.7


@dataclass
class VoicemailDetector:
    """Fed from the moment the call is answered; decides within `window_s`."""

    window_s: float = 8.0
    monologue_s: float = 6.5  # people talk over a greeting too; a voicemail greeting runs on longer
    beep_frames_needed: int = 2  # consecutive beep windows (~2 x 150 ms)
    started_at: float = 0.0
    verdict: Verdict = Verdict.UNKNOWN
    reason: str | None = None
    _speech_started: float | None = None
    _beep_run: int = 0
    _heard_short_turn: bool = False
    _texts: list[str] = field(default_factory=list)

    def start(self, now: float) -> None:
        self.started_at = now

    @property
    def open(self) -> bool:
        return self.verdict == Verdict.UNKNOWN

    def _decide(self, verdict: Verdict, reason: str) -> Verdict:
        self.verdict, self.reason = verdict, reason
        return verdict

    def _in_window(self, now: float) -> bool:
        return now - self.started_at <= self.window_s

    def on_user_started(self, now: float) -> Verdict:
        if self.open and self._in_window(now):
            self._speech_started = now
        return self.verdict

    def on_user_stopped(self, now: float) -> Verdict:
        if self.open and self._speech_started is not None:
            length = now - self._speech_started
            self._speech_started = None
            if length < 2.5:
                # "Hello?" then a pause: what a person does.
                self._heard_short_turn = True
        return self.verdict

    def on_transcript(self, text: str, now: float) -> Verdict:
        if not self.open:
            return self.verdict
        if self._in_window(now):
            self._texts.append(text)
            hit = phrase_hit(" ".join(self._texts))
            if hit:
                return self._decide(Verdict.MACHINE, f"phrase:{hit}")
        return self.verdict

    def on_audio(self, beep: bool, now: float) -> Verdict:
        if not self.open or not self._in_window(now):
            return self.verdict
        self._beep_run = self._beep_run + 1 if beep else 0
        if self._beep_run >= self.beep_frames_needed:
            return self._decide(Verdict.MACHINE, "beep")
        return self.verdict

    def tick(self, now: float) -> Verdict:
        if not self.open:
            return self.verdict
        if self._speech_started is not None and now - self._speech_started >= self.monologue_s:
            return self._decide(Verdict.MACHINE, "monologue")
        if not self._in_window(now):
            # Window over with no machine signal: a person (or silence, which the silence check-in handles).
            return self._decide(Verdict.HUMAN, "short_turn" if self._heard_short_turn else "window")
        return self.verdict
