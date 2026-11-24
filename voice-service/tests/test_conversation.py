from voice_service.conversation import Action, ProviderWatch, TurnState


def run(t: TurnState, start: float, end: float, step: float = 0.25) -> list[tuple[float, Action]]:
    out = []
    now = start
    while now <= end:
        a = t.tick(now)
        if a:
            out.append((now, a))
        now = round(now + step, 4)
    return out


def test_silence_check_in_then_goodbye() -> None:
    t = TurnState(silence_s=14)
    t.start(0)
    t.on_bot_started(0)
    t.on_bot_stopped(2)  # greeting done
    acts = run(t, 2, 40)
    assert acts[0] == (16.0, Action.CHECK_IN)
    assert acts[1] == (30.0, Action.GOODBYE)
    assert len(acts) == 2 and t.ending


def test_speech_resets_the_check_in() -> None:
    t = TurnState(silence_s=14)
    t.start(0)
    assert run(t, 0, 14) == [(14.0, Action.CHECK_IN)]
    t.on_user_started(15)
    t.on_user_stopped(16)
    t.on_bot_started(17)
    t.on_bot_stopped(18)
    # Back to a first check-in, not a goodbye.
    assert run(t, 18, 32)[0] == (32.0, Action.CHECK_IN)


def test_no_action_while_anyone_is_speaking_or_a_tool_runs() -> None:
    t = TurnState(silence_s=5)
    t.start(0)
    t.on_bot_started(0)
    assert run(t, 0, 60) == []
    t.on_bot_stopped(60)
    t.on_tool_started(60)
    assert run(t, 60, 120) == []


def test_dead_air_filler_then_apology() -> None:
    t = TurnState(silence_s=14, dead_air_s=3, stuck_s=9)
    t.start(0)
    t.on_user_started(1)
    t.on_user_stopped(2)  # reply owed from here
    acts = run(t, 2, 20)
    assert acts == [(5.0, Action.FILLER), (11.0, Action.APOLOGY_END)]


def test_reply_in_time_means_no_filler() -> None:
    t = TurnState(dead_air_s=3)
    t.start(0)
    t.on_user_stopped(1)
    t.on_bot_started(2.5)
    assert run(t, 1, 3) == []


def test_tool_wait_is_not_dead_air() -> None:
    t = TurnState(dead_air_s=3, stuck_s=9)
    t.start(0)
    t.on_user_stopped(1)
    t.on_tool_started(1.5)
    assert run(t, 1.5, 15) == []
    t.on_tool_finished(15)
    # The reply clock restarts when the tool returns.
    assert run(t, 15, 18.5) == [(18.0, Action.FILLER)]


def test_a_filler_does_not_count_as_the_reply() -> None:
    t = TurnState(dead_air_s=3, stuck_s=9)
    t.start(0)
    t.on_user_started(1)
    t.on_user_stopped(2)
    assert run(t, 2, 5) == [(5.0, Action.FILLER)]
    t.on_bot_started(5.25)  # "One moment."
    t.on_bot_stopped(6.0)
    assert run(t, 6.0, 20) == [(11.0, Action.APOLOGY_END)]


def test_the_reply_after_a_filler_clears_the_wait() -> None:
    t = TurnState(dead_air_s=3, stuck_s=9)
    t.start(0)
    t.on_user_stopped(2)
    assert run(t, 2, 5) == [(5.0, Action.FILLER)]
    t.on_bot_started(5.3)
    t.on_bot_stopped(6.1)
    t.on_bot_started(7.0)  # the reply
    t.on_bot_stopped(9.0)
    assert t.awaiting_reply_since is None and run(t, 9, 20) == []


def test_a_reply_played_right_behind_the_filler_clears_the_wait() -> None:
    t = TurnState(dead_air_s=3, stuck_s=9, filler_max_s=3)
    t.start(0)
    t.on_user_stopped(2)
    run(t, 2, 5)
    t.on_bot_started(5.3)
    t.on_bot_stopped(10.0)  # one segment: filler, then the reply without a gap
    assert t.awaiting_reply_since is None and run(t, 10, 20) == []


def test_a_tool_filler_keeps_the_reply_clock_for_after_the_tool() -> None:
    t = TurnState(dead_air_s=3, stuck_s=9)
    t.start(0)
    t.on_user_stopped(1)
    t.on_tool_started(1.5)
    t.on_filler_queued()
    t.on_bot_started(3.3)
    t.on_bot_stopped(4.0)
    t.on_tool_finished(6)
    assert run(t, 6, 16) == [(9.0, Action.FILLER), (15.0, Action.APOLOGY_END)]


def test_a_turn_nothing_was_transcribed_in_owes_no_reply() -> None:
    t = TurnState(silence_s=14, dead_air_s=3, stuck_s=9)
    t.start(0)
    t.on_user_started(1)
    t.on_user_stopped(1.5, reply_owed=False)  # a cough
    assert run(t, 1.5, 15.5) == [(15.5, Action.CHECK_IN)]


def test_watch_stt_errors_without_a_transcript_fail() -> None:
    w = ProviderWatch(stt_max_errors=3)
    w.on_stt_error()
    w.on_stt_error()
    w.on_transcript()  # it recovered
    w.on_stt_error()
    w.on_stt_error()
    assert w.tick(0) is None
    w.on_stt_error()
    assert w.tick(0) == "stt_error"


def test_watch_speech_that_never_gets_a_transcript_is_a_dead_stt() -> None:
    w = ProviderWatch(stt_miss_speech_s=1.5)
    w.on_user_turn_started()
    w.on_speech_started(10.0)
    w.on_speech_stopped(12.2)
    assert w.on_user_turn_stopped(17.0) is False
    assert w.tick(17.0) == "stt_timeout"


def test_watch_a_short_noise_or_a_heard_turn_is_fine() -> None:
    w = ProviderWatch(stt_miss_speech_s=1.5)
    w.on_speech_started(1.0)
    w.on_speech_stopped(1.4)  # a cough
    assert w.on_user_turn_stopped(6.0) is False and w.tick(6.0) is None
    w.on_speech_started(10.0)
    w.on_speech_stopped(13.0)
    w.on_transcript()
    assert w.on_user_turn_stopped(13.5) is True and w.tick(13.5) is None


def test_watch_an_stt_error_then_an_unheard_turn_fails_at_once() -> None:
    w = ProviderWatch()
    w.on_stt_error()
    w.on_speech_started(1.0)
    w.on_speech_stopped(1.6)
    w.on_user_turn_stopped(6.6)
    assert w.tick(6.6) == "stt_error"


def test_watch_speech_outside_a_turn_does_not_count() -> None:
    w = ProviderWatch(stt_miss_speech_s=1.5)
    w.on_speech_started(1.0)
    w.on_speech_stopped(2.2)  # never became a turn
    w.on_user_turn_started()
    w.on_speech_started(5.0)
    w.on_speech_stopped(5.5)
    w.on_user_turn_stopped(10.0)
    assert w.tick(10.0) is None


def test_watch_llm_first_token_timeout() -> None:
    w = ProviderWatch(llm_first_token_s=8)
    w.on_llm_started(10)
    assert w.tick(17.9) is None
    assert w.tick(18.0) == "llm_timeout"


def test_watch_llm_output_or_an_interruption_disarms_it() -> None:
    w = ProviderWatch(llm_first_token_s=8)
    w.on_llm_started(10)
    w.on_llm_output()
    assert w.tick(30) is None
    w.on_llm_started(40)
    w.on_interrupted()
    assert w.tick(60) is None
    w.on_llm_error()
    assert w.tick(60) == "llm_error"
