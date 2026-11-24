import numpy as np
import pytest

from voice_service.voicemail import Verdict, VoicemailDetector, is_beep, phrase_hit

SR = 16000


def tone(freq: float, secs: float = 0.15, amp: float = 0.5) -> np.ndarray:
    t = np.arange(int(SR * secs)) / SR
    return (amp * 32767 * np.sin(2 * np.pi * freq * t)).astype(np.int16)


def test_beep_is_a_loud_pure_tone() -> None:
    assert is_beep(tone(1000), SR)
    assert is_beep(tone(850), SR)
    rng = np.random.default_rng(1)
    noise = (rng.normal(0, 0.3, int(SR * 0.15)) * 32767).clip(-32768, 32767).astype(np.int16)
    assert not is_beep(noise, SR)
    # Speech-like: several harmonics of a voice pitch, not one narrow peak.
    voice = sum(tone(f, amp=0.15) for f in (180, 360, 540, 720, 900)).astype(np.int16)
    assert not is_beep(voice, SR)
    assert not is_beep(tone(1000, amp=0.001), SR)  # too quiet
    assert not is_beep(tone(100), SR)  # out of the beep band
    assert not is_beep(tone(1000, secs=0.01), SR)  # too short to judge


@pytest.mark.parametrize(
    "text",
    [
        "Please leave a message after the beep",
        "The number you have dialled is switched off",
        "For English, press 1",
        "आप जिस नंबर पर कॉल कर रहे हैं वह स्विच ऑफ है",
        "Hindi ke liye 2 dabaye",
    ],
)
def test_machine_phrases(text: str) -> None:
    assert phrase_hit(text)


@pytest.mark.parametrize("text", ["Hello?", "Haan ji, boliye", "Who is this?", "He's not available right now", "I'm busy"])
def test_human_openers_are_not_machines(text: str) -> None:
    assert phrase_hit(text) is None


def test_phrase_in_the_window_means_voicemail() -> None:
    d = VoicemailDetector(window_s=8)
    d.start(0)
    assert d.on_transcript("Hi, you've reached Ravi.", 1.5) == Verdict.UNKNOWN
    assert d.on_transcript("Please leave a message.", 3.0) == Verdict.MACHINE
    assert d.reason == "phrase:leave a message"


def test_beep_needs_consecutive_windows() -> None:
    d = VoicemailDetector(window_s=8)
    d.start(0)
    assert d.on_audio(True, 1.0) == Verdict.UNKNOWN
    assert d.on_audio(False, 1.15) == Verdict.UNKNOWN
    assert d.on_audio(True, 1.3) == Verdict.UNKNOWN
    assert d.on_audio(True, 1.45) == Verdict.MACHINE and d.reason == "beep"


def test_long_monologue_is_a_machine() -> None:
    d = VoicemailDetector(window_s=8, monologue_s=5.5)
    d.start(0)
    d.on_user_started(0.5)
    assert d.tick(5.0) == Verdict.UNKNOWN
    assert d.tick(6.1) == Verdict.MACHINE and d.reason == "monologue"


def test_hello_then_pause_is_human() -> None:
    d = VoicemailDetector(window_s=8)
    d.start(0)
    d.on_user_started(0.6)
    d.on_user_stopped(1.2)
    d.on_transcript("Hello?", 1.3)
    assert d.tick(4) == Verdict.UNKNOWN
    assert d.tick(8.1) == Verdict.HUMAN and d.reason == "short_turn"


def test_nothing_counts_after_the_window() -> None:
    d = VoicemailDetector(window_s=8)
    d.start(0)
    assert d.tick(8.5) == Verdict.HUMAN
    # Once decided, later phrases or beeps don't flip it.
    assert d.on_transcript("press 1 for the main menu", 20) == Verdict.HUMAN
    assert d.on_audio(True, 20) == Verdict.HUMAN and d.on_audio(True, 20.2) == Verdict.HUMAN
