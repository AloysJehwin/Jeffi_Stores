# Outreach end-to-end tests

Two harnesses prove the Outreach voice program before anything goes live:

- **A. Voice-to-voice** (`tests/voice-e2e/`, Python): the real voice-service, called by simulated phone owners over
  Exotel's AgentStream protocol, against a stub controller. Quality (latency, barge-in, transcript fidelity, cost) and
  resilience (provider outages, a dropped line, restarts). Runs with no keys; with keys it uses real Sarvam and Claude.
- **B. Outreach flow** (`tests/outreach-e2e/`, Playwright): CSV import to a claimed Showcase site on a trial, through the
  real controller on `jeffi_test`, with A's simulator answering the call.

Plus **C**, the live test runbook for after deploy.

## A. Voice-to-voice harness

### How it works

```
 run.py ──POST /calls (service token)──▶ voice-service (real: create_app + uvicorn, same as prod main())
   │                                        │ GET session / POST tools / POST events
   │                                        ▼
   │                              stub controller (FastAPI, logs every request with a timestamp)
   │                                        ▲
   │   fake Exotel REST ◀── POST /v1/Accounts/{sid}/Calls/connect.json (the real Exotel form)
   │        │ rings, posts the answered/terminal status callbacks (JSON)
   │        ▼
   └── simulated caller ══ WS /ws/exotel?k= ══▶ connected, start, media every 20 ms (8 kHz PCM) ... stop
            ◀══ media (the bot), clear (barge-in) ══
            plays the bot like a phone earpiece (real-time buffer; clear drops the unplayed part)
            writes calls/<callId>.wav and .mp3 (stereo: left caller, right bot)
```

voice-service's own code is untouched. The harness launcher (`e2e/serve_voice.py`, `e2e/voice_patches.py`) swaps only
its edges: the Exotel REST host (the fake), the providers (real or mock, per kind), a local recordings folder instead
of S3, and the fault switches.

| Piece | No-key run | Live run (`--live-keys`) |
|---|---|---|
| STT | mock: segments the caller's audio by energy and reports the words the caller was scripted to say | Sarvam saaras (voice-service's own client) |
| TTS | macOS `say` (lines pre-rendered so synthesis time doesn't count) | Sarvam bulbul, the persona's voice |
| LLM | a keyword-driven brain speaking the Messages API stream format | Claude through workload identity federation |
| Caller voice | macOS `say` (English) | Sarvam bulbul, a male voice (the bot is female), cached in `tests/voice-e2e/cache/` |

A no-key run proves voice-service's real pipeline (Silero VAD, Smart Turn, interruptions, the greeting and recording
gate, the voicemail detector, the tool dispatcher, the event and terminal rules, the watchdogs), the Exotel protocol
and the failure handling. It does not measure Sarvam or Claude latency, or how well the bot talks: that needs a live run.

### Run it

```bash
python3 tests/voice-e2e/run.py                         # every scenario that can run (about 15 min); no keys needed
python3 tests/voice-e2e/run.py --list                  # names, groups, what each needs
python3 tests/voice-e2e/run.py --scenario barge_in,stop
python3 tests/voice-e2e/run.py --group resilience      # protocol | conversation | load | resilience
```

The first run creates `tests/voice-e2e/.venv` with voice-service's pinned dependencies (uv, Python 3.12). Output goes
to `tests/voice-e2e/out/<timestamp>/` (gitignored): `report.md`, `report.json`, `calls/*.wav|mp3`,
`stub-controller.jsonl`, `voice-service.log`, `recordings/`. The exit code is 0 when nothing failed, 1 on a failure,
2 when it refused to start (spend cap, missing keys). An example no-key report is in
`tests/voice-e2e/examples/report.md`.

Unit tests of the harness itself (no network, no voice-service process):

```bash
tests/voice-e2e/.venv/bin/python -m pytest -c tests/voice-e2e/pytest.ini tests/voice-e2e/tests
```

### Live runs

Keys live in `~/.jeffi/voice-e2e.env` (mode 600, outside the repo); `voice-service/.env.e2e.local` (gitignored, see
`voice-service/.env.e2e.example`) overrides it field by field. The harness never prints them.

- `SARVAM_API_KEY`: real STT and TTS, and the caller's voice in Hindi and Tamil.
- Claude goes through **workload identity federation**, not an API key: `ANTHROPIC_ORGANIZATION_ID`,
  `ANTHROPIC_WORKSPACE_ID`, `ANTHROPIC_SERVICE_ACCOUNT_ID`, `ANTHROPIC_FEDERATION_RULE_ID`,
  `ANTHROPIC_IDENTITY_TOKEN_FILE`. With `--live-keys` the harness mints a fresh token
  (`node ai-platform/scripts/local-wif-token.mjs mint`, valid 1 h) when the current one is over 30 minutes old, and
  starts voice-service with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` removed (a Claude Code
  shell sets `ANTHROPIC_AUTH_TOKEN`, which shadows federation in an env-configured client). voice-service builds its
  Claude client from these variables with explicit credentials (`llm_client.py`); the harness wraps that same client
  to read usage and inject faults.
- `python3 tests/voice-e2e/run.py --check-keys` says which keys are set (names only), mints the token if stale, and
  sends one tiny Claude request through voice-service's own client. It places no call.
- Before any live run, the same check runs. **"Claude blocked: workspace spend limit"** means
  Anthropic answered 400 "workspace API usage limits" (the jeffi-local workspace is at its monthly limit until
  2026-12-01); Claude scenarios are then skipped with that reason, and any scenario that hits it mid-run is marked
  `BLOCKED`, not failed. An auth failure says to mint a token.
- Each provider is used when it is available: with only the Sarvam key, the run uses real STT and TTS with the mock
  brain, and the Claude-only scenarios are skipped.
- **Spend cap:** `--max-minutes` (default 15, or `E2E_MAX_MINUTES`) caps live call minutes. The harness adds up each
  selected scenario's worst case and refuses to start over the cap (pick fewer with `--scenario`); during the run it
  skips a scenario that would cross it.

```bash
node ai-platform/scripts/local-wif-token.mjs mint      # optional: the harness does it when the token is stale
python3 tests/voice-e2e/run.py --live-keys --scenario happy_en,happy_hi,happy_ta,bot_question,barge_in
```

### What each scenario proves

| Scenario | Needs | Proves (pass criteria) |
|---|---|---|
| `protocol` | none | POST /calls returns a providerCallId and is idempotent; the Exotel connect form (From, CallerId, flow URL, TimeOut 35, TimeLimit 900, CustomField, per-call JSON status callback); events ringing, answered, transcript, then exactly one `ended` with the provider's duration, the transcript and the recording key; the recording is stored; the greeting starts within 2 s and carries the recording notice; talking over the greeting doesn't cut it; media frames are well formed; every request carries a valid service token |
| `protocol_ws_guard` | none | a media socket with a wrong `?k=` or for an unknown call is refused (1008) |
| `no_answer`, `busy` | none | one `no_answer` / `busy` terminal event, no `answered` |
| `happy_en` | none (plumbing) / Claude (quality) | consent before the preview; startPreview gets the business name; addDetails, requestChange, publishSite in order; publish only after the caller asks; the controller's publish line is spoken; one `ended` |
| `happy_hi`, `happy_ta` | Sarvam + Claude | the same flow in Hindi and Tamil |
| `barge_in` | none | the caller cuts in 2 s into a long answer: `clear` within 1.0 s, the bot's audio stops within 1.2 s, then it answers the new question |
| `silence` | none | with `silenceS` = 6: a check-in after about 6 s, a goodbye, the bot hangs up |
| `voicemail` | none | a voicemail greeting then a beep: `voicemail` inside the 8 s window, no message left, no tools |
| `voicemail_beep` | none | a bare beep is caught by the tone detector alone |
| `bot_question` | Claude | asked "real person or robot?" it says it is an AI assistant, and never claims to be human |
| `stop` | none (plumbing) / Claude | "don't call me": optOut and nothing after it, a short goodbye, hang-up within 12 s |
| `language_switch` | none (plumbing) / Claude | switchLanguage(ta), and `ended` carries `redialLanguage: "ta"` |
| `concurrent_2`, `concurrent_5` | none | 2 and 5 simultaneous calls each greet within 2.5 s, get every reply, end with one terminal event; a 6th is refused 429 (the harness runs voice-service with `MAX_CONCURRENT_CALLS=5`; production is 2 per pod) |
| `fault_stt_5xx`, `fault_stt_timeout` | none | STT errors or goes silent mid-call: apology, hang-up, one `error` (`stt_error` / `stt_timeout`) |
| `fault_tts_5xx`, `fault_tts_timeout` | none | TTS breaks mid-call: no speech after it, hang-up, one `error` |
| `fault_llm_5xx`, `fault_llm_timeout` | none | Claude errors (after the SDK's retries) or never answers: the filler still plays, then the apology, hang-up, one `error` (`llm_error` / `llm_timeout`) |
| `fault_session_down` | none | the session can't be fetched at answer: the apology in the default voice, hang-up, `error` `session_unavailable` |
| `fault_tools_slow` | none | a 4 s tool reply is covered by "one moment" and still succeeds |
| `fault_controller_outage` | none | tools and events return 503 for 8 s: the tool fails without a false claim of success, and the terminal event still lands once the controller is back |
| `fault_ws_drop` | none | the media socket drops while the bot talks: one `ended` once Exotel reports the end |
| `fault_ws_drop_no_status` | none | the same with no provider callback: `ended` after the 30 s grace with `providerStatus: missing` |
| `fault_restart` | none | SIGTERM mid-call (a rolling restart): one `error` with reason `restart`, and the restarted process doesn't report it again |
| `fault_crash` | none | SIGKILL mid-call: the next process reports the orphaned call once (`error`, `restart`) |

**Faults** are switched on per call at the moment the scenario says (`POST /__e2e/fault` on the harness's voice-service,
or the stub's controller faults) and applied where the real service would surface them: an `ErrorFrame` carrying
Sarvam's `ApiError(503)` from the STT/TTS processor, audio that never comes back, an `InternalServerError` from the
Anthropic client, a request that never answers. "Documented behaviour" is voice-service's README (How a call behaves).

### Reading the report

- **Key numbers.** Response latency is the end of the caller's speech (from the audio, not the script) to the first
  bot audio the phone plays, per caller turn, p50 and p90; barge-in turns are excluded. Time to first greeting is from
  the media stream opening, on a warm process (the header's "Cold start" line is the first call after voice-service reports ready on `/readyz`). Barge-in stop time is how long the bot kept talking after the caller started; clear time
  is when voice-service sent `clear`. Terminal events counts placed calls with exactly one. Smart Turn timeouts are
  caller turns the end-of-turn model judged unfinished until `VOICE_TURN_MAX_WAIT_S` (2 s; 3 s before 2026-11-25) ran
  out: each one adds about that much to the reply, so they explain a high p90. Transcript fidelity (live only) re-transcribes the bot's audio
  with Sarvam STT and compares it with the bot's text from the events (WER, and CER for Indic scripts). Cost per call
  adds Sarvam STT (the caller's streamed minutes), TTS (spoken characters) and Claude (measured tokens) at the rates in
  `e2e/config.py` (`E2E_RATE_*` overrides); telephony is excluded. In a no-key run it is a projection.
- **Scenarios.** PASS / FAIL / SKIP (with the reason) / BLOCKED (Claude refused: spend limit or auth) / ERROR (the
  harness itself broke). "Plumbing only" marks conversation scenarios run with the mock brain.
- **Details.** Every assertion with its evidence, and per call: duration, who hung up, terminal event and reason, tools,
  latencies, cost and notes.
- **Listening.** `calls/<callId>.mp3`: left ear the caller, right ear the bot, on the phone's timeline.
- **Logs.** `stub-controller.jsonl` has every request voice-service made (timestamp, path, body, status, the tool
  reply); `voice-service.log` is voice-service at DEBUG (transcripts and pipecat's turn decisions; test data only).

### Findings (no-key runs, 2026-11-24) and fixes (2026-11-25)

The harness caught these voice-service behaviours. All are fixed; `examples/report.md` is a no-key run after the
fixes, in which every non-skipped scenario passes.

- **A bare beep never ended the call as voicemail** (`voicemail_beep`). The beep verdict closed the detector's window
  before `pipeline.tick()` looked, so it was never acted on. Now any machine verdict (beep, monologue, phrase) ends the
  call once as `voicemail`, and cuts short an ending already under way.
- **A broken STT or LLM didn't end the call with an apology** (`fault_stt_*`, `fault_llm_*`). A 5xx or a timeout is
  recoverable to pipecat, so the processor stayed usable and `_on_error` only logged; and the 9 s no-reply watchdog was
  disarmed by its own filler ("One moment." counted as the reply). Callers got a silence check-in 45 s later (STT
  down), dead air (Claude erroring), or silence without even the filler (Claude hanging: the filler was queued behind
  the stuck LLM). Now (`conversation.ProviderWatch`, `pipeline.py`):
  - STT: 3 errors with no transcript between them, or a turn of 1.5 s or more of speech (any speech after an STT error)
    that never gets a transcript, ends the call (`stt_error` / `stt_timeout`);
  - LLM: any error, a completion timeout, or no first token within 8 s (`llm_error` / `llm_timeout`);
  - only reply audio clears the watchdog, and a turn with nothing transcribed (a cough) owes no reply;
  - the filler and the apology go straight to TTS, so they play while the LLM is stuck (`fault_llm_timeout` now hears
    "One moment." at 3 s, then the apology);
  - the default apology promises a call back, and WhatsApp only when the session says `consentWhatsApp`.
- A broken TTS behaves as documented (`fault_tts_*`): no speech, hang-up, one `error` (`no_reply`).
- **The first call after a start greeted late** (2 to 9 s against about 0.46 s warm). Measured, that is mostly
  importing the call path (about 5 s); building the Silero VAD and Smart Turn sessions takes about 50 ms each.
  voice-service now does both at startup and answers `/readyz` 503 until they are done; the k8s startup and readiness
  probes use it, and the harness waits for it. Cold start in the no-key runs: 1.82 s before (9.29 s for the first
  call after a crash), 0.47 to 0.76 s after (0.47 s after a crash).
- **Smart Turn added 3 s to some replies** (15 of 42 caller turns). An offline probe (Smart Turn v3 on the scenarios'
  English sentences in four macOS voices, as 8 kHz telephone audio, with 0.2 s and 0.48 s of trailing silence) found
  two causes:
  - the harness's caller voice (Rishi) has flat question prosody that the model reads as unfinished. "Can you make the
    colours a bit warmer, more orange and gold?" scores P(complete) 0.01 in Rishi against 0.91 to 0.98 in Aman,
    Samantha and Daniel; "Sure, you can send it on WhatsApp." 0.18 against 0.63 to 0.96. Rishi has 12 of 23 sentences
    judged unfinished, the other voices 5 to 8;
  - short closings ("Okay, bye.", "Thank you, bye.", "Alright, I'm not interested. Bye.") score under 0.1 in every
    voice, so real callers will hit it too.

  `VOICE_TURN_MAX_WAIT_S` went from 3 s to 2 s, which takes a second off each of those turns. `VOICE_TURN_SILENCE_S`
  stays 0.48 s: with 0.2 s of trailing silence the model judged more turns unfinished (Aman 11 against 6), not fewer.
  Barge-in starts on VAD, so it is unaffected (bot audio stopped after p50 0.79 s, max 1.24 s, before and after).

  | No-key run | Turns | p50 | p90 | Smart Turn timeouts |
  |---|---|---|---|---|
  | all scenarios, before (3 s) | 49 | 0.73 s | 4.08 s | 15 of 42 |
  | all scenarios, after (2 s) | 50 | 0.74 s | 2.98 s | 15 of 42 |
  | turn-taking subset*, Rishi, 3 s, before | 18 | 0.71 s | 3.70 s | 5 |
  | turn-taking subset, Rishi, 3 s, fixed code | 18 | 0.70 s | 3.68 s | 5 |
  | turn-taking subset, Rishi, 2 s | 18 | 0.71 s | 2.76 s | 5 |
  | turn-taking subset, Aman, 3 s | 18 | 0.70 s | 3.72 s | 3 |
  | turn-taking subset, Aman, 2 s | 18 | 0.71 s | 2.82 s | 3 |

  \*protocol, happy_en, barge_in, stop, language_switch, concurrent_2 (`E2E_CALLER_SAY_VOICE`, `VOICE_TURN_MAX_WAIT_S`).
  The fixes alone don't move latency (3.70 against 3.68 s); the wait does. In Aman's voice the consent and colour
  turns no longer time out (its owner line does), and the closings still do, so p90 barely changes between voices.

  A live run with real voices is still the check before tuning further.
- Passing and solid: the protocol, events and the single terminal event (every placed call had exactly one), the
  recording gate, barge-in, silence, STOP, the language switch, 2 and 5 concurrent calls with the 429 at the cap, a
  slow or briefly down controller, dropped sockets (with and without Exotel's callback) and both kinds of restart.

### Limits

- Telephony is simulated from Exotel's AgentStream documentation and pipecat's Exotel serializer; a real Exotel line
  (runbook below) is the final word. Twilio's media path is not exercised here (in serve mode a `twilio_test` provider
  is answered over the Exotel protocol).
- The mock brain is English and keyword-driven: in a no-key run, conversation scenarios prove plumbing, not judgement.
- Recordings go to a local folder (the same encoder and key as S3).
- Smart Turn timeouts are counted from voice-service's debug log in each call's time window, so they are approximate
  when calls overlap (the load scenarios are left out of the total).

## B. Outreach flow (Playwright)

`tests/outreach-e2e/outreach-flow.spec.ts` drives one lead through the whole program on a local stack, through the
controller's real routes:

1. **Test mode.** The program is enabled with the test number as its only test number, and the platform's voice
   provider is `twilio_test` (Settings > Providers, `PUT /api/admin/settings/providers` on admin-service). Both are
   restored afterwards.
2. **Import.** A one-row CSV (`POST /api/admin/ecom/outreach/lists`) becomes a `queued` contact. It has no
   `dnd_status`, so a real lead would be skipped; test numbers are exempt in test mode.
3. **Simulator.** `run.py serve` starts voice-service on port 8095 pointed at the real controller. Every call is
   answered by a simulated owner who goes through the English happy path. The simulated network always speaks Exotel's
   protocol with dummy credentials, so no number is ever dialled.
4. **Dial.** The worker runs through its cron route (`GET /api/cron/outreach-calls`, Bearer `CRON_SECRET`; the cron
   itself is k8sOnly). Outside 09:30-20:30 IST it skips `outside_window`, and the spec places the call through
   `POST /api/admin/ecom/outreach/test-call` instead (noted in the test's annotations).
5. **The call.** The owner goes through the happy path. `GET /api/admin/ecom/outreach/calls/{id}` must show
   `completed`, the recording notice in the transcript, consent evidence and audit events.
6. **Build and publish.** The contact reaches `published` with a Showcase site attached.
7. **WhatsApp.** Capture mode's messages, through the controller's own `readCapturedWhatsApp`
   (`tests/outreach-e2e/captured.ts` under tsx), hold `preview_ready` and the preview and claim links. Claim links are
   masked in events; the captured message keeps the real one outside production.
8. **Preview.** The page returns 200 and is noindex, shows the business, and shows the "Go to your live site" banner.
9. **Claim.** The owner signs in on ecom with an email OTP (the repo's `ownerLogin`, which writes the code to local
   Redis) and opens the claim link. It lands on `/dashboard/showcase/<siteId>`.
10. **Trial.** The dashboard shows the trial, the contact is `claimed`, and `showcase_sites.owner_id` is the claimer.

Run it (the main session runs the apps; agents never run `next dev`):

```bash
# controller (and admin-service, ecom) on jeffi_test, with:
#   VOICE_SERVICE_URL=http://127.0.0.1:8095, the same SERVICE_AUTH_SECRET as .env.local, CRON_SECRET set
npx playwright test -c tests/outreach-e2e/playwright.config.ts
```

Env:

| Variable | Default | What it is |
|---|---|---|
| `OUTREACH_E2E_CONTROLLER_URL` | `http://localhost:3013` | the controller |
| `OUTREACH_E2E_ADMIN_URL` | `http://localhost:3011` | admin-service, for the provider switch |
| `OUTREACH_E2E_ECOM_URL` | `http://ecom.localhost:3000` | ecom |
| `OUTREACH_E2E_VOICE_PORT` | `8095` | the simulator's voice-service port (8090 is the local Claude gateway) |
| `OUTREACH_E2E_TEST_PHONE` | `+919000000001` | the test number |
| `OUTREACH_E2E_LIVE_KEYS` | unset | `1` for real Sarvam and Claude in the simulator |

The global setup mints a platform-admin session with `tests/ui-kit/session.ts` (jeffi_test only). A step skips with
its reason when a piece isn't running locally: no test DB, no controller, admin-service down when the provider has to
change, no `VOICE_SERVICE_URL`, or a `CRON_SECRET` mismatch. A piece that runs and misbehaves fails the test.

The same `run.py serve` is how harness A runs against the real controller's session, tools and events: start it, then
place test calls from the admin Outreach page or this spec. Voice-only runs keep the stub.

## C. Live test runbook (after deploy)

Live means real telephony: the Twilio test line or Exotel, calling **only the founder's own number**, which must be the
only entry on the program's test list. Never add anyone else's number; the program stays disabled throughout.

**Before**

1. A no-key run is green, and a live harness run (`--live-keys`, 15 min cap) has been
   listened to: `happy_en`, `happy_hi`, `happy_ta`, `bot_question`, `barge_in`, `stop`. Note its key numbers.
2. Deployed: voice-service at `replicas: 1`, `voice.jeffistores.in` resolving to the cluster (not proxied), the
   `voice-service` secret (`SERVICE_AUTH_SECRET`, `VOICE_WS_KEY`), Claude federation configured for voice-service, and
   the workspace spend limit raised.
3. Admin Settings > Providers: Sarvam key and voices; Exotel (SID, key, token, subdomain, the 140-series caller ID,
   the test flow's app ID with Voicebot `wss://voice.jeffistores.in/ws/exotel?k=<VOICE_WS_KEY>` then Hangup) or Twilio
   test (SID, token, from number).
4. Admin > Ecom > Outreach: test numbers = the founder's number only; program **disabled** (the test call works
   without it). For the Twilio test line, the voice provider is `twilio_test` (test mode: voice-service refuses any
   number off the test list). Inside 09:30-20:30 IST.

**Calls** (from the program card's test call, one at a time)

5. English: answer, confirm you're the owner, agree to WhatsApp, describe the business, ask for a change, ask it to
   publish, say bye. Expect the recording notice in the greeting, short turns, the preview link on WhatsApp within a
   minute, the live and claim links after publishing.
6. Check the call detail: transcript, recording (it starts after the notice), consent evidence, events with exactly
   one terminal event, the outcome.
7. Open the preview link on the phone: it renders and refreshes as you speak; after publish it shows "Go to your live
   site" with the 30 minute countdown.
8. Open the claim link, sign in with the founder's email OTP: the site is in the workspace with the 7-day trial.
9. Hindi, then Tamil (test call language), the same flow.
10. Behaviour checks, one call each: interrupt mid-sentence (it stops quickly and answers); stay silent (check-in, then
    goodbye); ask "are you a real person?" (it says it is Jeffi Stores' AI assistant); say "don't call me again" (it
    stops, says goodbye, hangs up; the number lands on the suppression list: remove it from suppressions afterwards to
    keep testing); ask to switch to Tamil (it hangs up and rings back in Tamil).
11. Optional resilience drill: during a call, `kubectl --kubeconfig ~/.kube/jeffi-k3s.yaml -n jeffi rollout restart
    deploy/jeffi-stores-voice-service`; expect the call to drop and one `error` (reason `restart`) on it.

**Sign-off**: every step behaved; latency feels natural (compare with the live harness numbers); no message or call
reached any number but the founder's. **Abort** and disable the program if a call reaches any other number, a
recording starts before the notice, the bot claims to be human, or STOP is not honoured.
