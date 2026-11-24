"""PCM helpers: 8 kHz 16-bit mono telephony audio, speech segmentation, beeps, WAV/MP3 output, `say` synthesis."""

from __future__ import annotations

import hashlib
import io
import shutil
import subprocess
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np

RATE = 8000
FRAME_MS = 20
FRAME_SAMPLES = RATE * FRAME_MS // 1000  # 160
FRAME_BYTES = FRAME_SAMPLES * 2  # 320
SPEECH_DBFS = -42.0


def silence(seconds: float, rate: int = RATE) -> bytes:
    return b"\x00\x00" * int(rate * seconds)


def to_i16(pcm: bytes) -> np.ndarray:
    return np.frombuffer(pcm[: len(pcm) - len(pcm) % 2], dtype=np.int16)


def dbfs(pcm: bytes) -> float:
    x = to_i16(pcm).astype(np.float64)
    if x.size == 0:
        return -120.0
    rms = float(np.sqrt(np.mean(x * x))) / 32768.0
    return 20 * np.log10(rms) if rms > 0 else -120.0


def frames(pcm: bytes, size: int = FRAME_BYTES) -> list[bytes]:
    """20 ms frames; the last one padded with silence."""
    out = [pcm[i : i + size] for i in range(0, len(pcm), size)]
    if out and len(out[-1]) < size:
        out[-1] = out[-1] + b"\x00" * (size - len(out[-1]))
    return out


def beep(seconds: float = 1.0, freq: float = 1000.0, amp: float = 0.5, rate: int = RATE) -> bytes:
    t = np.arange(int(rate * seconds)) / rate
    return (np.sin(2 * np.pi * freq * t) * amp * 32767).astype(np.int16).tobytes()


def resample(pcm: bytes, src: int, dst: int) -> bytes:
    if src == dst or not pcm:
        return pcm
    x = to_i16(pcm).astype(np.float64)
    n = int(round(x.size * dst / src))
    y = np.interp(np.linspace(0, x.size - 1, n), np.arange(x.size), x)
    return np.clip(y, -32768, 32767).astype(np.int16).tobytes()


@dataclass
class Segment:
    start: float  # seconds from track start
    end: float

    @property
    def length(self) -> float:
        return self.end - self.start


def speech_segments(pcm: bytes, rate: int = RATE, threshold: float = SPEECH_DBFS, hangover_s: float = 0.3,
                    min_len_s: float = 0.08) -> list[Segment]:
    """Voiced stretches by frame energy, joined across gaps shorter than `hangover_s`."""
    step = rate * FRAME_MS // 1000 * 2
    segs: list[Segment] = []
    cur: Segment | None = None
    for i in range(0, len(pcm) - step + 1, step):
        t = i / 2 / rate
        voiced = dbfs(pcm[i : i + step]) > threshold
        if voiced:
            if cur is not None and t - cur.end <= hangover_s:
                cur.end = t + FRAME_MS / 1000
            else:
                if cur is not None:
                    segs.append(cur)
                cur = Segment(t, t + FRAME_MS / 1000)
    if cur is not None:
        segs.append(cur)
    return [s for s in segs if s.length >= min_len_s]


def speech_bounds(pcm: bytes, rate: int = RATE) -> tuple[float, float] | None:
    segs = speech_segments(pcm, rate)
    return (segs[0].start, segs[-1].end) if segs else None


def wav_bytes(pcm: bytes, rate: int = RATE, channels: int = 1) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return out.getvalue()


def read_wav(data: bytes) -> tuple[bytes, int]:
    """(mono 16-bit PCM, rate). Stereo is down-mixed."""
    with wave.open(io.BytesIO(data), "rb") as w:
        rate, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if width != 2:
        raise ValueError(f"expected 16-bit wav, got {width * 8}-bit")
    if ch == 2:
        x = to_i16(raw).reshape(-1, 2).mean(axis=1).astype(np.int16)
        raw = x.tobytes()
    return raw, rate


def stereo(left: bytes, right: bytes) -> bytes:
    a, b = to_i16(left), to_i16(right)
    n = max(a.size, b.size)
    a = np.pad(a, (0, n - a.size))
    b = np.pad(b, (0, n - b.size))
    return np.column_stack([a, b]).astype(np.int16).tobytes()


def write_call_audio(path_base: Path, caller: bytes, bot: bytes, rate: int = RATE) -> list[Path]:
    """Stereo WAV (left caller, right bot) and, when lameenc is there, an MP3 next to it."""
    st = stereo(caller, bot)
    wav = path_base.with_suffix(".wav")
    wav.write_bytes(wav_bytes(st, rate, 2))
    out = [wav]
    try:
        import lameenc

        enc = lameenc.Encoder()
        enc.set_bit_rate(48)
        enc.set_in_sample_rate(rate)
        enc.set_channels(2)
        enc.set_quality(5)
        mp3 = path_base.with_suffix(".mp3")
        mp3.write_bytes(bytes(enc.encode(st) + enc.flush()))
        out.append(mp3)
    except Exception:  # noqa: BLE001
        pass
    return out


def have_say() -> bool:
    return shutil.which("say") is not None and shutil.which("ffmpeg") is not None


def say_pcm(text: str, voice: str = "", rate: int = RATE, wpm: int = 0) -> bytes:
    """macOS `say` -> AIFF -> ffmpeg -> mono 16-bit PCM at `rate`."""
    if not have_say():
        raise RuntimeError("`say` and ffmpeg are needed for the English fallback voice")
    with tempfile.TemporaryDirectory() as d:
        aiff = Path(d) / "s.aiff"
        cmd = ["say", "-o", str(aiff)]
        if voice:
            cmd += ["-v", voice]
        if wpm:
            cmd += ["-r", str(wpm)]
        subprocess.run([*cmd, text], check=True, capture_output=True, timeout=60)
        r = subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-i", str(aiff), "-ac", "1", "-ar", str(rate), "-f", "s16le", "-"],
            check=True, capture_output=True, timeout=60,
        )
        return r.stdout


def cache_key(*parts: str) -> str:
    return hashlib.sha1("\x1f".join(parts).encode()).hexdigest()[:20]


def cached_pcm(cache_dir: Path, key: str, make) -> bytes:  # type: ignore[no-untyped-def]
    cache_dir.mkdir(parents=True, exist_ok=True)
    f = cache_dir / f"{key}.pcm"
    if f.exists():
        return f.read_bytes()
    pcm = make()
    tmp = f.with_suffix(".tmp")
    tmp.write_bytes(pcm)
    tmp.replace(f)
    return pcm
