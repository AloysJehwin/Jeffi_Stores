"""Call recording, gated on consent: nothing is kept until the greeting (which carries "this call may be recorded")
has finished playing. Encoded to MP3 and stored at outreach/recordings/{callId}.mp3."""

from __future__ import annotations

import asyncio
import io
import wave
from collections.abc import Callable
from dataclasses import dataclass, field

from .log import get_logger

log = get_logger("voice.recording")


@dataclass
class RecordingGate:
    """Closed until the notice has played in full: the first bot utterance after `notice_queued` must start and stop.
    An utterance cut short (`interrupted`) does not count."""

    notice_queued: bool = False
    _notice_playing: bool = False
    open: bool = False
    opened_at: float | None = None

    def queue_notice(self) -> None:
        self.notice_queued = True

    def on_bot_started(self) -> None:
        if self.notice_queued and not self.open:
            self._notice_playing = True

    def on_bot_stopped(self, now: float, interrupted: bool = False) -> bool:
        """True when this call opened the gate."""
        if self.open or not self._notice_playing:
            return False
        self._notice_playing = False
        if interrupted:
            return False
        self.open, self.opened_at = True, now
        return True


@dataclass
class CallRecorder:
    gate: RecordingGate
    sample_rate: int = 8000
    channels: int = 1
    max_bytes: int = 64 * 1024 * 1024
    _buf: bytearray = field(default_factory=bytearray)
    dropped_before_gate: int = 0

    def add(self, pcm: bytes, sample_rate: int | None = None, channels: int | None = None) -> None:
        if not self.gate.open:
            self.dropped_before_gate += len(pcm)
            return
        if sample_rate:
            self.sample_rate = sample_rate
        if channels:
            self.channels = channels
        if len(self._buf) + len(pcm) <= self.max_bytes:
            self._buf.extend(pcm)

    @property
    def size(self) -> int:
        return len(self._buf)

    def wav_bytes(self) -> bytes:
        out = io.BytesIO()
        with wave.open(out, "wb") as w:
            w.setnchannels(self.channels)
            w.setsampwidth(2)
            w.setframerate(self.sample_rate)
            w.writeframes(bytes(self._buf))
        return out.getvalue()

    def mp3_bytes(self) -> bytes:
        import lameenc

        enc = lameenc.Encoder()
        enc.set_bit_rate(32)
        enc.set_in_sample_rate(self.sample_rate)
        enc.set_channels(self.channels)
        enc.set_quality(5)
        return bytes(enc.encode(bytes(self._buf)) + enc.flush())

    def encode(self) -> tuple[bytes, str, str]:
        """(body, extension, content type): MP3, or WAV when the encoder is unavailable."""
        try:
            return self.mp3_bytes(), "mp3", "audio/mpeg"
        except Exception as e:  # noqa: BLE001
            log.warning("mp3 encode failed; storing wav", error=type(e).__name__)
            return self.wav_bytes(), "wav", "audio/wav"


def recording_key(call_id: str, ext: str, prefix: str = "") -> str:
    key = f"outreach/recordings/{call_id}.{ext}"
    return f"{prefix.strip('/')}/{key}" if prefix.strip("/") else key


Uploader = Callable[[str, str, bytes, str], None]  # (bucket, key, body, content_type)


def s3_uploader(region: str) -> Uploader:
    import boto3

    client = boto3.client("s3", region_name=region)

    def upload(bucket: str, key: str, body: bytes, content_type: str) -> None:
        client.put_object(Bucket=bucket, Key=key, Body=body, ContentType=content_type, ServerSideEncryption="AES256")

    return upload


async def store_recording(
    recorder: CallRecorder, call_id: str, bucket: str, prefix: str, upload: Uploader | None
) -> str | None:
    """Uploads the gated audio; returns the S3 key, or None when there is nothing (or nowhere) to store."""
    if not recorder.gate.open or recorder.size == 0 or not bucket or upload is None:
        return None
    body, ext, ctype = await asyncio.to_thread(recorder.encode)
    key = recording_key(call_id, ext, prefix)
    try:
        await asyncio.to_thread(upload, bucket, key, body, ctype)
    except Exception as e:  # noqa: BLE001
        log.error("recording upload failed", callId=call_id, error=type(e).__name__)
        return None
    log.info("recording stored", callId=call_id, bytes=len(body))
    return key
