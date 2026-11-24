from voice_service.conversation import Action, TurnState


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
