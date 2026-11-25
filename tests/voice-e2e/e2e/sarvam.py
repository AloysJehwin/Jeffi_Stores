"""Sarvam REST calls the harness makes itself: Bulbul TTS for the caller's voice, and STT to re-transcribe the bot.

The key is passed in per call and sent only as the `api-subscription-key` header; it is never logged.
"""

from __future__ import annotations

import base64

import httpx

from .audio import read_wav, resample, wav_bytes

BASE = "https://api.sarvam.ai"
LANG_CODES = {"en": "en-IN", "hi": "hi-IN", "ta": "ta-IN", "te": "te-IN", "kn": "kn-IN", "ml": "ml-IN", "mr": "mr-IN",
              "bn": "bn-IN", "gu": "gu-IN"}


def lang_code(language: str) -> str:
    return LANG_CODES.get((language or "en").split("-")[0].lower(), "en-IN")


class SarvamError(Exception):
    pass


def tts(text: str, language: str, speaker: str, key: str, rate: int = 8000, model: str = "bulbul:v3",
        timeout: float = 30.0) -> bytes:
    """Mono 16-bit PCM at `rate`."""
    payload = {"text": text, "target_language_code": lang_code(language), "speaker": speaker,
               "speech_sample_rate": rate, "model": model, "pace": 1.0}
    r = httpx.post(f"{BASE}/text-to-speech", json=payload, timeout=timeout,
                   headers={"api-subscription-key": key, "content-type": "application/json"})
    if r.status_code != 200:
        raise SarvamError(f"tts {r.status_code}")
    audios = r.json().get("audios") or []
    if not audios:
        raise SarvamError("tts returned no audio")
    pcm, got = read_wav(base64.b64decode(audios[0]))
    return resample(pcm, got, rate)


def stt(pcm: bytes, rate: int, language: str, key: str, model: str = "saaras:v3", timeout: float = 60.0) -> str:
    """One short clip (under ~30 s) -> transcript."""
    audio = wav_bytes(resample(pcm, rate, 16000), 16000)
    r = httpx.post(
        f"{BASE}/speech-to-text",
        headers={"api-subscription-key": key},
        data={"model": model, "language_code": lang_code(language)},
        files={"file": ("clip.wav", audio, "audio/wav")},
        timeout=timeout,
    )
    if r.status_code != 200:
        raise SarvamError(f"stt {r.status_code}")
    return str(r.json().get("transcript") or "")
