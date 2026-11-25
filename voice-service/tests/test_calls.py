import pytest

from voice_service.calls import Call, CallRegistry, CallStatus, CapacityError, Outcome, terminal_event


def call(**kw) -> Call:  # type: ignore[no-untyped-def]
    c = Call(call_id="c1", to="+91", from_="", language="hi", provider="exotel", created_at=0)
    for k, v in kw.items():
        setattr(c, k, v)
    return c


def test_unanswered_outcomes_map_from_the_provider() -> None:
    assert terminal_event(call(provider_status=CallStatus.NO_ANSWER), 50)[0] == "no_answer"  # type: ignore[index]
    assert terminal_event(call(provider_status=CallStatus.BUSY), 50)[0] == "busy"  # type: ignore[index]
    assert terminal_event(call(provider_status=CallStatus.FAILED), 50) == ("error", {"reason": "failed"})
    assert terminal_event(call(provider_status=CallStatus.COMPLETED), 50)[0] == "no_answer"  # type: ignore[index]
    assert terminal_event(call(), 50) is None  # still ringing


def test_answered_call_waits_for_both_provider_and_pipeline() -> None:
    c = call(answered_at=10, stream_started_at=10.5)
    assert terminal_event(c, 20) is None
    c.pipeline_done, c.stream_ended_at = True, 70
    c.transcript, c.recording_key = [{"role": "agent", "text": "hi"}], "outreach/recordings/c1.mp3"
    assert terminal_event(c, 71) is None  # waits for the provider's record
    c.provider_status, c.provider_duration_s, c.provider_terminal_at = CallStatus.COMPLETED, 61, 72
    ev = terminal_event(c, 72)
    assert ev is not None
    kind, data = ev
    assert kind == "ended" and data["durationS"] == 61 and data["durationSource"] == "provider"
    assert data["recordingKey"] == "outreach/recordings/c1.mp3" and data["transcript"][0]["text"] == "hi"


def test_missing_provider_record_falls_back_to_the_local_clock_after_grace() -> None:
    c = call(answered_at=10, stream_started_at=10, pipeline_done=True, stream_ended_at=40)
    assert terminal_event(c, 60, grace_s=30) is None
    kind, data = terminal_event(c, 71, grace_s=30)  # type: ignore[misc]
    assert kind == "ended" and data["durationS"] == 30 and data["providerStatus"] == "missing"


def test_outcomes_voicemail_error_and_redial() -> None:
    done = {"answered_at": 1, "stream_started_at": 1, "pipeline_done": True, "stream_ended_at": 9,
            "provider_status": CallStatus.COMPLETED, "provider_terminal_at": 9}
    assert terminal_event(call(**done, outcome=Outcome.VOICEMAIL), 9)[0] == "voicemail"  # type: ignore[index]
    kind, data = terminal_event(call(**done, outcome=Outcome.ERROR, error_reason="tts_error"), 9)  # type: ignore[misc]
    assert kind == "error" and data["reason"] == "tts_error"
    kind, data = terminal_event(call(**done, redial_language="ta"), 9)  # type: ignore[misc]
    assert kind == "ended" and data["redialLanguage"] == "ta"
    assert terminal_event(call(**done, terminal_sent=True), 9) is None


def test_registry_idempotency_and_cap(tmp_path) -> None:  # type: ignore[no-untyped-def]
    r = CallRegistry(max_concurrent=2, state_dir=str(tmp_path))
    a, created = r.reserve("a", "+91", "", "hi", "exotel")
    assert created
    again, created = r.reserve("a", "+91", "", "hi", "exotel")
    assert again is a and not created
    r.reserve("b", "+92", "", "hi", "exotel")
    with pytest.raises(CapacityError):
        r.reserve("c", "+93", "", "hi", "exotel")
    r.bind_provider_id(a, "P-a")
    assert r.by_provider_id("P-a") is a
    r.mark_terminal(a)
    r.reserve("c", "+93", "", "hi", "exotel")  # a slot freed up
    assert r.active_count() == 2


def test_restart_recovery_reads_inflight_once(tmp_path) -> None:  # type: ignore[no-untyped-def]
    first = CallRegistry(max_concurrent=5, state_dir=str(tmp_path))
    c, _ = first.reserve("a", "+91", "", "hi", "exotel")
    first.bind_provider_id(c, "P-a")
    first.reserve("b", "+92", "", "hi", "exotel")
    done, _ = first.reserve("d", "+93", "", "hi", "exotel")
    first.mark_terminal(done)
    # A new process (same state dir) finds a and b in flight, once.
    second = CallRegistry(max_concurrent=5, state_dir=str(tmp_path))
    orphans = second.take_orphans()
    assert sorted(o["callId"] for o in orphans) == ["a", "b"]
    assert second.take_orphans() == []
