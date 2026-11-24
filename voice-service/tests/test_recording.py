from typing import Any

from voice_service.recording import CallRecorder, RecordingGate, recording_key, store_recording

PCM = b"\x01\x00" * 800  # 100 ms at 8 kHz


def test_gate_stays_closed_until_the_notice_has_played() -> None:
    g = RecordingGate()
    g.on_bot_started()
    assert g.on_bot_stopped(1.0) is False and not g.open  # speech before the notice was queued doesn't count
    g.queue_notice()
    assert not g.open
    g.on_bot_started()
    assert not g.open  # playing, not finished
    assert g.on_bot_stopped(4.0) is True and g.open and g.opened_at == 4.0
    assert g.on_bot_stopped(5.0) is False  # opens once


def test_an_interrupted_notice_does_not_open_the_gate() -> None:
    g = RecordingGate()
    g.queue_notice()
    g.on_bot_started()
    assert g.on_bot_stopped(2.0, interrupted=True) is False and not g.open
    g.on_bot_started()
    assert g.on_bot_stopped(6.0) is True


def test_no_audio_is_kept_before_the_gate_opens() -> None:
    g = RecordingGate()
    r = CallRecorder(gate=g)
    r.add(PCM)
    r.add(PCM)
    assert r.size == 0 and r.dropped_before_gate == 2 * len(PCM)
    g.queue_notice()
    g.on_bot_started()
    g.on_bot_stopped(3.0)
    r.add(PCM, 8000, 1)
    assert r.size == len(PCM)


async def test_store_uploads_only_after_consent() -> None:
    uploads: list[tuple[str, str, bytes, str]] = []

    def up(bucket: str, key: str, body: bytes, ctype: str) -> None:
        uploads.append((bucket, key, body, ctype))

    g = RecordingGate()
    r = CallRecorder(gate=g)
    r.add(PCM)
    assert await store_recording(r, "call-1", "bucket", "", up) is None and uploads == []

    g.queue_notice()
    g.on_bot_started()
    g.on_bot_stopped(1.0)
    r.add(PCM * 10)
    key = await store_recording(r, "call-1", "bucket", "prod", up)
    assert key is not None and key.startswith("prod/outreach/recordings/call-1.")
    bucket, k, body, ctype = uploads[0]
    assert bucket == "bucket" and k == key and len(body) > 0 and ctype in ("audio/mpeg", "audio/wav")


async def test_store_skips_without_a_bucket_and_survives_upload_errors() -> None:
    g = RecordingGate(notice_queued=True)
    g.on_bot_started()
    g.on_bot_stopped(1.0)
    r = CallRecorder(gate=g)
    r.add(PCM)
    assert await store_recording(r, "c", "", "", lambda *a: None) is None

    def boom(*_: Any) -> None:
        raise RuntimeError("s3 down")

    assert await store_recording(r, "c", "bucket", "", boom) is None


def test_recording_key() -> None:
    assert recording_key("abc", "mp3") == "outreach/recordings/abc.mp3"
    assert recording_key("abc", "mp3", "/staging/") == "staging/outreach/recordings/abc.mp3"


def test_wav_fallback_is_valid() -> None:
    g = RecordingGate(open=True)
    r = CallRecorder(gate=g)
    r.add(PCM)
    wav = r.wav_bytes()
    assert wav[:4] == b"RIFF" and wav[8:12] == b"WAVE"
