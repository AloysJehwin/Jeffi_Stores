<!-- Example: a no-key run of python3 tests/voice-e2e/run.py on a Mac, 2026-11-25, after the voice-service resilience fixes, committed for reference (audio and logs are not). How to read it: docs/OUTREACH_E2E.md. -->

# Voice E2E report, 2026-11-25 01:32:11

- Mode: **no-key** (STT mock, TTS mock, LLM mock)
- voice-service at `f4ecdb459`, pipecat 1.15.0, LLM model `claude-haiku-5-5`, MAX_CONCURRENT_CALLS=5
- Ran 29 scenarios in 927s: 26 pass, 3 skip
- Cold start: the first call after voice-service became ready (/readyz) greeted after 0.76s; an unreported warm-up call takes that, and the scenarios run warm

> No-key run: Sarvam and Claude are replaced by mocks (an energy-segmenting STT that reports the caller's scripted words, macOS `say` as TTS, and a keyword-driven brain). It proves voice-service's real pipeline, turn-taking, barge-in, the Exotel protocol, tools plumbing, events and failure handling. It does not measure Sarvam/Claude latency or conversation quality; latency here is voice-service's own floor (VAD + turn detection + framework).

## Key numbers

| Metric | Value |
|---|---|
| Response latency, end of caller speech to first bot audio | p50 0.74s, p90 2.98s (50 turns) |
| Time to first greeting (from the media stream opening) | p50 0.46s, p90 0.47s (28 calls) |
| Barge-in: bot audio stopped after | p50 0.79s, max 1.24s; clear sent after p50 0.39s (2) |
| Terminal events | 30/30 placed calls had exactly one |
| Smart Turn waited the full VOICE_TURN_MAX_WAIT_S (2 s) | 15 of 42 caller turns (each adds about 2 s to that reply) |
| Tool-call checks | 7/7 passed |
| Transcript fidelity (bot audio re-transcribed vs bot text) | skipped: needs Sarvam STT (live run) |
| Cost per call (STT + TTS + LLM, telephony excluded) | Rs 0.77/call, Rs 1.56/min over 13.79 min; Claude tokens as the mock reports them (about request size / 4) (projected, providers mocked) |

## Scenarios

| Scenario | Group | Result | Latency p50/p90 | Greeting | Terminal | Notes |
|---|---|---|---|---|---|---|
| protocol | protocol | **PASS** | 0.69s / 0.69s | 0.46s | ended |  |
| protocol_ws_guard | protocol | **PASS** | n/a / n/a | n/a | - |  |
| no_answer | protocol | **PASS** | n/a / n/a | n/a | no_answer |  |
| busy | protocol | **PASS** | n/a / n/a | n/a | busy |  |
| happy_en | conversation | **PASS** | 1.71s / 2.75s | 0.47s | ended | plumbing only (mocked brain). |
| happy_hi | conversation | **SKIP** | n/a / n/a | n/a | - | needs Sarvam (SARVAM_API_KEY in ~/.jeffi/voice-e2e.env, run with --live-keys); needs Claude (WIF variables, run with --live-keys) |
| happy_ta | conversation | **SKIP** | n/a / n/a | n/a | - | needs Sarvam (SARVAM_API_KEY in ~/.jeffi/voice-e2e.env, run with --live-keys); needs Claude (WIF variables, run with --live-keys) |
| barge_in | conversation | **PASS** | 0.67s / 2.33s | 0.47s | ended | plumbing only (mocked brain). |
| silence | conversation | **PASS** | n/a / n/a | 0.46s | ended |  |
| voicemail | conversation | **PASS** | n/a / n/a | 0.47s | voicemail |  |
| voicemail_beep | conversation | **PASS** | n/a / n/a | 0.46s | voicemail |  |
| bot_question | conversation | **SKIP** | n/a / n/a | n/a | - | needs Claude (WIF variables, run with --live-keys) |
| stop | conversation | **PASS** | 1.01s / 1.32s | 0.46s | ended | plumbing only (mocked brain). |
| language_switch | conversation | **PASS** | 0.55s / 0.62s | 0.47s | ended | plumbing only (mocked brain). |
| concurrent_2 | load | **PASS** | 1.68s / 2.77s | 0.45s | ended,ended |  |
| concurrent_5 | load | **PASS** | 1.69s / 2.74s | 0.46s | ended,ended,ended,ended,ended |  |
| fault_stt_5xx | resilience | **PASS** | 3.21s / 5.19s | 0.46s | error |  |
| fault_stt_timeout | resilience | **PASS** | 3.32s / 5.38s | 0.46s | error |  |
| fault_tts_5xx | resilience | **PASS** | 0.74s / 0.74s | 0.46s | error |  |
| fault_tts_timeout | resilience | **PASS** | 0.75s / 0.75s | 0.47s | error |  |
| fault_llm_5xx | resilience | **PASS** | 1.75s / 2.59s | 0.47s | error |  |
| fault_llm_timeout | resilience | **PASS** | 3.29s / 5.32s | 0.45s | error |  |
| fault_session_down | resilience | **PASS** | n/a / n/a | 0.09s | error |  |
| fault_tools_slow | resilience | **PASS** | 4.50s / 4.51s | 0.45s | ended |  |
| fault_controller_outage | resilience | **PASS** | 2.70s / 2.79s | 0.46s | ended |  |
| fault_ws_drop | resilience | **PASS** | 0.73s / 0.73s | 0.46s | ended |  |
| fault_ws_drop_no_status | resilience | **PASS** | 0.72s / 0.72s | 0.47s | ended |  |
| fault_restart | resilience | **PASS** | 0.71s / 0.72s | 0.47s | error |  |
| fault_crash | resilience | **PASS** | 0.67s / 0.69s | 0.49s | error |  |

## Skipped or blocked

- **happy_hi** (Happy path, Hindi): needs Sarvam (SARVAM_API_KEY in ~/.jeffi/voice-e2e.env, run with --live-keys); needs Claude (WIF variables, run with --live-keys)
- **happy_ta** (Happy path, Tamil): needs Sarvam (SARVAM_API_KEY in ~/.jeffi/voice-e2e.env, run with --live-keys); needs Claude (WIF variables, run with --live-keys)
- **bot_question** ("Are you a bot?"): needs Claude (WIF variables, run with --live-keys)

## Details

### protocol: Exotel protocol, events and greeting (PASS)

The AgentStream handshake, media framing, the Exotel REST form, status callbacks, the event sequence with exactly one terminal event, idempotent placing, the recording notice and gate, service-token auth.

- PASS: POST /calls -> 200 with providerCallId
- PASS: a repeated POST /calls for the same callId is idempotent (duplicate: true, same id)
- PASS: Exotel connect form: From=lead, CallerId=ExoPhone, flow URL, timeouts, CustomField
- PASS: status callback per call, JSON, answered + terminal events
- PASS: events: ringing, answered, transcript batches, then the terminal one last
- PASS: exactly one terminal event (ended)
- PASS: ended carries durationS from the provider, the transcript and the recording key
- PASS: recording stored at outreach/recordings/{callId}.mp3
- PASS: talking over the greeting does not cut it (it keeps playing; a clear drops nothing)
- PASS: bot media frames are well-formed (base64 16-bit PCM, our stream_sid)
- PASS: caller hung up with a stop event; voice-service closed the call
- PASS: every voice-service request carried a valid service token (service=voice, callId)
- PASS: greeting starts within 2.0s of the stream opening
- PASS: greeting carries the recording notice
- call `e2e-protocol-0-60de06`: 23.26s, closed by caller, terminal ['ended'], tools [], latencies [0.69], greeting 0.46s, cost Rs 0.73

### protocol_ws_guard: Media socket guard (PASS)

Sockets with a wrong key or for a call voice-service did not place are refused.

- PASS: a media socket with the wrong ?k= is refused (1008)
- PASS: a media socket for an unknown call is refused (1008)

### no_answer: Not answered (PASS)

A ring with no answer ends with one no_answer event.

- PASS: exactly one terminal event (no_answer)
- PASS: no answered event
- call `e2e-no_answer-0-6c938f`: 0.0s, closed by no-answer, terminal ['no_answer:no_answer'], tools [], latencies [-], greeting n/a, cost Rs 0.00

### busy: Busy (PASS)

A busy line ends with one busy event.

- PASS: exactly one terminal event (busy)
- PASS: no answered event
- call `e2e-busy-0-b616f2`: 0.0s, closed by busy, terminal ['busy:busy'], tools [], latencies [-], greeting n/a, cost Rs 0.00

### happy_en: Happy path, English (PASS)

Owner confirmed, consent, preview, details, a change, publish, goodbye: the tools in order and the controller's lines spoken.

- PASS: tools called in order: startPreview > addDetails > requestChange > publishSite
- PASS: consent recorded before the preview (WhatsApp needs consent)
- PASS: startPreview got the business name
- PASS: publishSite only after the caller asked to publish
- PASS: the controller's publish line was spoken
- PASS: exactly one terminal event (ended)
- PASS: greeting starts within 2.0s of the stream opening
- PASS: greeting carries the recording notice
- PASS: every voice-service request carried a valid service token (service=voice, callId)
- call `e2e-happy_en-0-84e15b`: 74.44s, closed by bot, terminal ['ended'], tools ['recordConsent', 'startPreview', 'addDetails', 'requestChange', 'publishSite', 'markOutcome'], latencies [0.74, 2.71, 0.68, 2.67, 0.75, 2.80], greeting 0.47s, cost Rs 1.70

### barge_in: Barge-in (PASS)

The caller cuts in mid-sentence: clear goes out, the bot stops fast and answers the new question.

- PASS: the caller cut in while the bot was talking
- PASS: voice-service sent clear within 1.0 s of the caller starting
- PASS: the bot's audio stopped within 1.2 s
- PASS: the bot answered the new question after the interruption
- PASS: exactly one terminal event (ended)
- call `e2e-barge_in-0-b6c24e`: 46.31s, closed by bot, terminal ['ended'], tools ['markOutcome'], latencies [0.50, 0.67, 2.75], greeting 0.47s, cost Rs 1.71

### silence: Long silence (PASS)

Nobody speaks: a check-in after silenceS, then a goodbye and the bot hangs up.

- PASS: greeting, then a check-in, then a goodbye (3+ bot utterances)
- PASS: check-in after about 6s of silence (+-3s)
- PASS: the bot hung up (not the caller)
- PASS: the call ended within 40 s
- PASS: exactly one terminal event (ended)
- call `e2e-silence-0-188a60`: 27.46s, closed by bot, terminal ['ended'], tools [], latencies [-], greeting 0.46s, cost Rs 0.58

### voicemail: Voicemail (greeting + beep) (PASS)

A voicemail greeting then a beep ends the call as voicemail inside the 8 s window, leaving no message.

- PASS: exactly one terminal event (voicemail)
- PASS: cut within 9.5s of answer
- PASS: the bot hung up (not the caller)
- PASS: no message left and no tools called
- call `e2e-voicemail-0-162244`: 3.83s, closed by bot, terminal ['voicemail'], tools [], latencies [-], greeting 0.47s, cost Rs 0.25

### voicemail_beep: Voicemail (beep only) (PASS)

A bare beep (no words) is caught by the tone detector alone.

- PASS: exactly one terminal event (voicemail)
- PASS: cut within 6.0s of answer
- PASS: the bot hung up (not the caller)
- PASS: no message left and no tools called
- call `e2e-voicemail_beep-0-f5f247`: 1.32s, closed by bot, terminal ['voicemail'], tools [], latencies [-], greeting 0.46s, cost Rs 0.23

### stop: STOP / don't call (PASS)

'Don't call me' is honoured at once: optOut, a short goodbye, hang up, no pitch.

- PASS: optOut called, and nothing after it
- PASS: the bot hung up (not the caller)
- PASS: hung up within 12 s of 'stop'
- PASS: no pitching after stop: at most the goodbye line
- PASS: exactly one terminal event (ended)
- call `e2e-stop-0-54b234`: 24.7s, closed by bot, terminal ['ended'], tools ['optOut'], latencies [1.40, 0.62], greeting 0.46s, cost Rs 0.64

### language_switch: Language switch (PASS)

Asked for Tamil: switchLanguage, then ended carries redialLanguage=ta.

- PASS: switchLanguage called with ta
- PASS: ended carries redialLanguage=ta (the controller rings back in Tamil)
- PASS: the bot hung up (not the caller)
- PASS: exactly one terminal event (ended)
- call `e2e-language_switch-0-a0a147`: 27.7s, closed by bot, terminal ['ended'], tools ['switchLanguage'], latencies [0.47, 0.64], greeting 0.47s, cost Rs 0.73

### concurrent_2: Two concurrent calls (PASS)

Two calls at once: each greets fast, replies on time and ends with one terminal event.

- PASS: all 2 calls answered and ended with exactly one terminal event
- PASS: every greeting started within 2.5 s
- PASS: every caller turn got a reply
- PASS: response latency p50 under 2.5 s while concurrent (p90 is dominated by Smart Turn waits)
- PASS: every voice-service request carried a valid service token (service=voice, callId)
- call `e2e-concurrent_2-0-bcf31b`: 27.15s, closed by bot, terminal ['ended'], tools ['markOutcome'], latencies [0.61, 2.78], greeting 0.45s, cost Rs 0.68
- call `e2e-concurrent_2-1-5bdb78`: 27.15s, closed by bot, terminal ['ended'], tools ['markOutcome'], latencies [0.62, 2.73], greeting 0.46s, cost Rs 0.68

### concurrent_5: Five concurrent calls (PASS)

Five at once (MAX_CONCURRENT_CALLS=5 here), and a sixth refused with 429.

- PASS: all 5 calls answered and ended with exactly one terminal event
- PASS: every greeting started within 2.5 s
- PASS: every caller turn got a reply
- PASS: response latency p50 under 2.5 s while concurrent (p90 is dominated by Smart Turn waits)
- PASS: every voice-service request carried a valid service token (service=voice, callId)
- PASS: call 6 is refused with 429 at MAX_CONCURRENT_CALLS=5
- call `e2e-concurrent_5-0-0d75e9`: 27.43s, closed by bot, terminal ['ended'], tools ['markOutcome'], latencies [0.66, 2.73], greeting 0.46s, cost Rs 0.68
- call `e2e-concurrent_5-1-c5122c`: 27.43s, closed by bot, terminal ['ended'], tools ['markOutcome'], latencies [0.66, 2.73], greeting 0.44s, cost Rs 0.68
- call `e2e-concurrent_5-2-1a4ce1`: 27.42s, closed by bot, terminal ['ended'], tools ['markOutcome'], latencies [0.66, 2.75], greeting 0.46s, cost Rs 0.68
- call `e2e-concurrent_5-3-96b170`: 27.18s, closed by bot, terminal ['ended'], tools ['markOutcome'], latencies [0.60, 2.74], greeting 0.46s, cost Rs 0.68
- call `e2e-concurrent_5-4-599377`: 27.43s, closed by bot, terminal ['ended'], tools ['markOutcome'], latencies [0.66, 2.73], greeting 0.51s, cost Rs 0.68

### fault_stt_5xx: Sarvam STT 5xx mid-call (PASS)

STT starts failing mid-call: apology, hang-up, one error event.

- PASS: exactly one terminal event (error)
- PASS: reason reported
- PASS: apologised ('the line's breaking up...')
- PASS: the bot hung up (not the caller)
- PASS: ended within 25 s of the fault
- call `e2e-fault_stt_5xx-0-9fda43`: 34.46s, closed by bot, terminal ['error:stt_error'], tools [], latencies [0.73, 5.69], greeting 0.46s, cost Rs 0.80

### fault_stt_timeout: Sarvam STT stops answering (PASS)

STT goes silent mid-call: apology, hang-up, one error event.

- PASS: exactly one terminal event (error)
- PASS: reason reported
- PASS: apologised ('the line's breaking up...')
- PASS: the bot hung up (not the caller)
- PASS: ended within 25 s of the fault
- call `e2e-fault_stt_timeout-0-ed9b6b`: 34.67s, closed by bot, terminal ['error:stt_timeout'], tools [], latencies [0.74, 5.89], greeting 0.46s, cost Rs 0.80

### fault_tts_5xx: Sarvam TTS 5xx mid-call (PASS)

TTS fails mid-call: nothing can be said, so hang up at once, one error event.

- PASS: exactly one terminal event (error)
- PASS: reason reported
- PASS: no speech after the fault (TTS is what broke: hang up straight away)
- PASS: the bot hung up (not the caller)
- PASS: ended within 25 s of the fault
- call `e2e-fault_tts_5xx-0-07e96f`: 42.2s, closed by bot, terminal ['error:no_reply'], tools ['recordConsent', 'startPreview'], latencies [0.74], greeting 0.46s, cost Rs 1.03

### fault_tts_timeout: Sarvam TTS stops answering (PASS)

TTS goes silent mid-call: hang up, one error event.

- PASS: exactly one terminal event (error)
- PASS: reason reported
- PASS: no speech after the fault (TTS is what broke: hang up straight away)
- PASS: the bot hung up (not the caller)
- PASS: ended within 25 s of the fault
- call `e2e-fault_tts_timeout-0-ab629f`: 42.19s, closed by bot, terminal ['error:no_reply'], tools ['recordConsent', 'startPreview'], latencies [0.75], greeting 0.47s, cost Rs 1.03

### fault_llm_5xx: Claude 5xx mid-call (PASS)

Claude errors (after the SDK's retries): apology, hang-up, one error event.

- PASS: exactly one terminal event (error)
- PASS: reason reported
- PASS: apologised ('the line's breaking up...')
- PASS: the bot hung up (not the caller)
- PASS: ended within 25 s of the fault
- call `e2e-fault_llm_5xx-0-77fe03`: 31.41s, closed by bot, terminal ['error:llm_error'], tools [], latencies [0.70, 2.80], greeting 0.47s, cost Rs 0.77

### fault_llm_timeout: Claude never answers (PASS)

Claude hangs: the 9 s no-reply watchdog apologises and hangs up, one error event.

- PASS: exactly one terminal event (error)
- PASS: reason reported
- PASS: apologised ('the line's breaking up...')
- PASS: the bot hung up (not the caller)
- PASS: ended within 25 s of the fault
- call `e2e-fault_llm_timeout-0-667228`: 39.67s, closed by bot, terminal ['error:llm_timeout'], tools [], latencies [0.75, 5.82], greeting 0.45s, cost Rs 0.86

### fault_session_down: Controller down at answer (PASS)

The session can't be fetched: the apology in the default voice, hang up, error session_unavailable.

- PASS: exactly one terminal event (error)
- PASS: reason session_unavailable
- PASS: apologised in audio, then hung up
- call `e2e-fault_session_down-0-ef97f5`: 3.54s, closed by bot, terminal ['error:session_unavailable'], tools [], latencies [-], greeting 0.09s, cost Rs 0.03

### fault_tools_slow: Controller slow (tools 4 s) (PASS)

A slow tool is covered by a filler and still succeeds.

- PASS: a filler ('one moment') covered the slow tool
- PASS: the slow tool still succeeded
- PASS: exactly one terminal event (ended)
- call `e2e-fault_tools_slow-0-23f809`: 54.41s, closed by caller, terminal ['ended'], tools ['recordConsent', 'startPreview'], latencies [0.76, 4.50, 4.51], greeting 0.45s, cost Rs 1.07

### fault_controller_outage: Controller down mid-call (8 s) (PASS)

Tools fail during an outage without a false claim of success; the terminal event still lands once it is back.

- PASS: the tool call hit the outage (503)
- PASS: no false success after the failed tool
- PASS: exactly one terminal event (ended/error)
- PASS: the terminal event was delivered once the controller came back
- call `e2e-fault_controller_outage-0-dc568d`: 39.52s, closed by bot, terminal ['ended'], tools ['recordConsent', 'markOutcome'], latencies [0.72, 2.81, 2.70], greeting 0.46s, cost Rs 0.98

### fault_ws_drop: Media socket dropped mid-call (PASS)

The line drops while the bot talks: one ended event once Exotel reports the end.

- PASS: exactly one terminal event (ended)
- PASS: reported within 10 s of the drop, provider duration
- call `e2e-fault_ws_drop-0-8c2e7d`: 15.02s, closed by drop, terminal ['ended'], tools [], latencies [0.73], greeting 0.46s, cost Rs 0.55

### fault_ws_drop_no_status: Socket dropped, provider never reports (PASS)

No terminal callback from Exotel: the event still goes out after the 30 s grace (providerStatus=missing).

- PASS: exactly one terminal event (ended)
- PASS: no provider status: reported after the 30 s grace with providerStatus=missing
- call `e2e-fault_ws_drop_no_status-0-ca64a7`: 15.03s, closed by drop, terminal ['ended'], tools [], latencies [0.72], greeting 0.47s, cost Rs 0.55

### fault_restart: voice-service restart (SIGTERM) mid-call (PASS)

A rolling restart ends live calls with one error event (reason restart), never two.

- PASS: exactly one terminal event (error)
- PASS: reason restart
- PASS: the restarted process did not report it again
- call `e2e-fault_restart-0-eb845d`: 27.34s, closed by bot, terminal ['error:restart'], tools [], latencies [0.72, 0.69], greeting 0.47s, cost Rs 1.31

### fault_crash: voice-service crash (SIGKILL) mid-call (PASS)

After a crash, the next process reports the orphaned call once (error, restart).

- PASS: exactly one terminal event (error)
- PASS: reason restart
- PASS: the restarted process reported the orphan
- call `e2e-fault_crash-0-b39fa6`: 27.27s, closed by bot, terminal ['error:restart'], tools [], latencies [0.69, 0.65], greeting 0.49s, cost Rs 0.45

How to read this: docs/OUTREACH_E2E.md. Audio (stereo: left caller, right bot), the stub controller's request log and voice-service's log are next to this file.
