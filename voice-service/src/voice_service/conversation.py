"""Turn-level timing as pure state machines: silence check-ins, dead-air fillers, the stuck-reply apology, and the
provider watch (an STT or LLM that broke without pipecat calling it fatal).

The pipeline feeds them events (bot/user started/stopped speaking, tool start/end, transcripts, LLM output) and calls
`tick(now)` a few times a second; `TurnState.tick` returns at most one action, `ProviderWatch.tick` a failure reason.
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
    filler_max_s: float = 3.0  # a "filler" that plays longer than this carried the reply right behind it
    last_activity: float = 0.0
    bot_speaking: bool = False
    user_speaking: bool = False
    tools_in_flight: int = 0
    awaiting_reply_since: float | None = None
    filler_played: bool = False
    filler_pending: bool = False  # a filler was queued and hasn't started playing
    filler_speaking: bool = False  # the bot audio now playing is a filler, not the reply
    check_ins: int = 0
    ending: bool = False
    _bot_started_at: float = 0.0

    def start(self, now: float) -> None:
        self.last_activity = now

    def on_filler_queued(self) -> None:
        """The next bot audio is a filler: it must not count as the reply."""
        self.filler_pending = True

    def on_bot_started(self, now: float) -> None:
        self.bot_speaking = True
        self.last_activity = now
        self._bot_started_at = now
        if self.filler_pending:
            self.filler_pending = False
            self.filler_speaking = True
            return
        self.awaiting_reply_since = None
        self.filler_played = False

    def on_bot_stopped(self, now: float) -> None:
        self.bot_speaking = False
        self.last_activity = now
        if self.filler_speaking:
            self.filler_speaking = False
            if now - self._bot_started_at > self.filler_max_s:
                self.awaiting_reply_since = None
                self.filler_played = False

    def on_user_started(self, now: float) -> None:
        self.user_speaking = True
        self.check_ins = 0
        self.last_activity = now
        self.filler_pending = False  # the interruption drops a filler that hasn't played

    def on_user_stopped(self, now: float, reply_owed: bool = True) -> None:
        """End of the user's turn (after turn detection). A turn nothing was transcribed in (a cough, noise) gets no
        reply, so it owes none."""
        self.user_speaking = False
        self.last_activity = now
        if reply_owed:
            self.awaiting_reply_since = now
            self.filler_played = False

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
                self.filler_pending = True
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


@dataclass
class ProviderWatch:
    """Notices a broken STT or LLM that pipecat treats as recoverable (a 5xx or a timeout leaves the processor usable):

    - STT: `stt_max_errors` errors with no transcript between them; or a user turn with speech and no transcript at
      all, when it ran `stt_miss_speech_s` or longer or followed an STT error;
    - LLM: any error, or no first token (text, thinking or a tool call) within `llm_first_token_s` of starting.
    """

    stt_max_errors: int = 3
    stt_miss_speech_s: float = 1.5
    llm_first_token_s: float = 8.0
    stt_errors: int = 0
    turn_speech_s: float = 0.0
    turn_transcripts: int = 0
    llm_waiting_since: float | None = None
    failure: str | None = None
    _speech_started: float | None = None

    def _fail(self, reason: str) -> None:
        if self.failure is None:
            self.failure = reason

    def on_stt_error(self) -> None:
        self.stt_errors += 1
        if self.stt_errors >= self.stt_max_errors:
            self._fail("stt_error")

    def on_transcript(self) -> None:
        self.stt_errors = 0
        self.turn_transcripts += 1

    def on_speech_started(self, at: float) -> None:
        """VAD speech start, back-dated to when the speech began."""
        if self._speech_started is None:
            self._speech_started = at

    def on_speech_stopped(self, at: float) -> None:
        """VAD speech stop, back-dated to when the speech ended."""
        if self._speech_started is not None:
            self.turn_speech_s += max(0.0, at - self._speech_started)
            self._speech_started = None

    def on_user_turn_started(self) -> None:
        self.turn_speech_s = 0.0  # speech that never became a turn doesn't count against this one

    def on_user_turn_stopped(self, now: float) -> bool:
        """End of a user turn. Returns whether anything was transcribed in it (a reply is owed)."""
        if self._speech_started is not None:
            self.on_speech_stopped(now)
        heard = self.turn_transcripts > 0
        if not heard and self.turn_speech_s > 0 and (self.stt_errors or self.turn_speech_s >= self.stt_miss_speech_s):
            self._fail("stt_error" if self.stt_errors else "stt_timeout")
        self.turn_speech_s, self.turn_transcripts = 0.0, 0
        return heard

    def on_llm_started(self, now: float) -> None:
        self.llm_waiting_since = now

    def on_llm_output(self) -> None:
        self.llm_waiting_since = None

    def on_interrupted(self) -> None:
        """The user cut in: the LLM run is cancelled (it may never push its end frame)."""
        self.llm_waiting_since = None

    def on_llm_error(self) -> None:
        self._fail("llm_error")

    def on_llm_timeout(self) -> None:
        self._fail("llm_timeout")

    def tick(self, now: float) -> str | None:
        if self.llm_waiting_since is not None and now - self.llm_waiting_since >= self.llm_first_token_s:
            self._fail("llm_timeout")
        return self.failure
