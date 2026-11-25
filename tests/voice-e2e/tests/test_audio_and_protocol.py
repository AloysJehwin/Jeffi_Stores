from __future__ import annotations

import json

import numpy as np
import pytest

from e2e import audio
from e2e.phone import CallRecord, _Speaker, media_message, start_message
from e2e.vs import VOICE_SRC  # noqa: F401  (puts voice-service/src on the path)


def test_frames_are_20ms() -> None:
    fr = audio.frames(b"\x01\x00" * 250)
    assert [len(f) for f in fr] == [320, 320]
    assert fr[-1].endswith(b"\x00" * 100)


def test_speech_segments_and_bounds() -> None:
    pcm = audio.silence(0.5) + audio.beep(1.0, amp=0.2) + audio.silence(0.2) + audio.beep(0.5, amp=0.2) + audio.silence(1.0)
    segs = audio.speech_segments(pcm)
    assert len(segs) == 1  # the 0.2 s gap is inside the hangover
    lo, hi = audio.speech_bounds(pcm)
    assert abs(lo - 0.5) < 0.03 and abs(hi - 2.2) < 0.03


def test_beep_is_what_voice_service_calls_a_beep() -> None:
    from voice_service.voicemail import is_beep

    window = np.frombuffer(audio.beep(0.15), dtype=np.int16)
    assert is_beep(window, 8000)


def test_stereo_and_wav_round_trip() -> None:
    st = audio.stereo(b"\x01\x00\x02\x00", b"\x03\x00")
    pcm, rate = audio.read_wav(audio.wav_bytes(st, 8000, 2))
    assert rate == 8000 and len(pcm) == 4


def test_start_message_is_detected_as_exotel_by_pipecat() -> None:
    from pipecat.runner.utils import _detect_transport_type_from_message

    assert _detect_transport_type_from_message({"event": "connected"}) == "unknown"
    assert _detect_transport_type_from_message(start_message("s1", "c1", "+91", "+91140")) == "exotel"


@pytest.mark.asyncio
async def test_media_message_deserializes_with_the_exotel_serializer() -> None:
    from pipecat.frames.frames import InputAudioRawFrame
    from pipecat.serializers.exotel import ExotelFrameSerializer

    ser = ExotelFrameSerializer(stream_sid="s1", params=ExotelFrameSerializer.InputParams(sample_rate=8000))
    ser._sample_rate = 8000
    frame = await ser.deserialize(json.dumps(media_message("s1", 0, audio.beep(0.02), 2)))
    assert isinstance(frame, InputAudioRawFrame) and len(frame.audio) == 320


def test_speaker_plays_in_real_time_and_clear_drops_the_unplayed_part() -> None:
    rec = CallRecord(call_id="c")
    sp = _Speaker(rec)
    tone = audio.beep(0.5, amp=0.3)
    sp.play(tone, now=1.0)
    sp.play(tone, now=1.1)  # arrived early: queued behind the first
    assert rec.bot_onsets == [1.0] and abs(sp.cursor - 2.0) < 1e-9 and rec.max_lead_s == 0.9
    assert sp.speaking(1.5)
    sp.clear(1.2)
    assert rec.clear_dropped_s == [0.8] and len(rec.bot) == int(1.2 * 8000) * 2
    assert not sp.speaking(1.6)
