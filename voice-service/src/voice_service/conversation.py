"""Turn-level timing as a pure state machine: silence check-ins, dead-air fillers, the stuck-reply apology.

The pipeline feeds it events (bot/user started/stopped speaking, tool start/end) and calls `tick(now)` a few times a
second; `tick` returns at most one action for the pipeline to perform.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Action(StrEnum):
    CHECK_IN = "check_in"  # first silence: "are you still there?"
    GOODBYE = "goodbye"  # second silence: polite goodbye, then hang up
    FILLER = "filler"  # the reply is late: "one moment"
    APOLOGY_END = "apology_end"  # the reply never came: apologise and end


@dataclass
class TurnState:
    silence_s: float = 14.0
    dead_air_s: float = 3.0
    stuck_s: float = 9.0  # after the user's turn, no reply by now: the LLM/TTS is stuck
    last_activity: float = 0.0
    bot_speaking: bool = False
    user_speaking: bool = False
    tools_in_flight: int = 0
    awaiting_reply_since: float | None = None
    filler_played: bool = False
    check_ins: int = 0
    ending: bool = False

    def start(self, now: float) -> None:
        self.last_activity = now

    def on_bot_started(self, now: float) -> None:
        self.bot_speaking = True
        self.awaiting_reply_since = None
        self.filler_played = False
        self.last_activity = now

    def on_bot_stopped(self, now: float) -> None:
        self.bot_speaking = False
        self.last_activity = now

    def on_user_started(self, now: float) -> None:
        self.user_speaking = True
        self.check_ins = 0
        self.last_activity = now

    def on_user_stopped(self, now: float) -> None:
        """End of the user's turn (after turn detection): a reply is now owed."""
        self.user_speaking = False
        self.awaiting_reply_since = now
        self.filler_played = False
        self.last_activity = now

    def on_tool_started(self, now: float) -> None:
        self.tools_in_flight += 1
        self.last_activity = now

    def on_tool_finished(self, now: float) -> None:
        self.tools_in_flight = max(0, self.tools_in_flight - 1)
        self.last_activity = now
        if self.awaiting_reply_since is not None:
            # The tool's own wait was covered by its filler; time the reply from here.
            self.awaiting_reply_since = now
            self.filler_played = False

    def tick(self, now: float) -> Action | None:
        if self.ending or self.bot_speaking or self.user_speaking:
            return None
        if self.tools_in_flight:
            return None  # the tool dispatcher plays its own filler
        if self.awaiting_reply_since is not None:
            waited = now - self.awaiting_reply_since
            if waited >= self.stuck_s:
                self.ending = True
                return Action.APOLOGY_END
            if waited >= self.dead_air_s and not self.filler_played:
                self.filler_played = True
                return Action.FILLER
            return None
        if now - self.last_activity >= self.silence_s:
            self.last_activity = now
            if self.check_ins == 0:
                self.check_ins = 1
                return Action.CHECK_IN
            self.check_ins = 2
            self.ending = True
            return Action.GOODBYE
        return None
