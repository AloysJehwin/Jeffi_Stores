# voice-service

Real-time AI calling for Outreach (plan §8): a Pipecat pipeline per call, driven by the controller.

```
 controller ──POST /calls──────────────▶ voice-service ──REST──▶ Exotel (prod) / Twilio (test only)
     ▲  ▲                                   │   ▲                     │ dials the lead
     │  │ GET  .../voice-config (60 s cache)│   │ status callbacks    ▼
     │  │ GET  .../calls/{id}/session ◀─────┤   └───────────── POST /telephony/{provider}/status/{callId}
     │  │ POST .../calls/{id}/tools/{tool} ◀┤
     │  └ POST .../calls/{id}/events ◀──────┤   media WebSocket (8 kHz PCM, both ways)
     │                                      ▼
     │        ┌──────────────── Pipecat pipeline (one per call) ─────────────────────────────┐
     │        │ WS in ─▶ Sarvam STT (saaras:v3, streaming) ─▶ user turn (Silero VAD +        │
     │        │ Smart Turn v3) ─▶ Claude (Haiku 5.5, streaming, tools, cached system prompt) │
     │        │ ─▶ Sarvam TTS (bulbul:v3, streaming) ─▶ WS out ─▶ recorder (consent-gated)   │
     │        └──────────────────────────────────────────────────────────────────────────────┘
     │                                      │ MP3
     └── outreach/recordings/{callId}.mp3 ◀─┘ S3
```

**Speech engines.** STT and TTS are chosen separately per call, Sarvam by default or Azure AI Speech (`speech.sttProvider` /
`speech.ttsProvider` in the voice-config, env `VOICE_STT_PROVIDER` / `VOICE_TTS_PROVIDER`). The chosen engine is tried
first; when it has no credentials or can't be built at call start, the other one is used and the call goes on
(`speech.py`, logged as `speech engines`). A failure after the call has started is the failure path below (apology, one
`error`). Azure voices are per language (`azureSpeech.voices`; defaults `hi-IN-SwaraNeural`, `ta-IN-PallaviNeural`,
`te-IN-ShrutiNeural`, `kn-IN-SapnaNeural`, `ml-IN-SobhanaNeural`, `mr-IN-AarohiNeural`, `bn-IN-TanishaaNeural`,
`gu-IN-DhwaniNeural`, `en-IN-NeerjaNeural`); a session `persona.voiceId` is used only when it is an Azure voice name for
Azure and only when it is not one for Sarvam. One usable engine (a Sarvam key or an Azure key) is enough to take calls.

The persona, script, greeting and tools all come from the controller's session (`GET .../session`); nothing about
what the agent says is hard-coded here, apart from a filler ("one moment") and the failure apology, per language.

## Contract with the controller

| Direction | Call | Notes |
|---|---|---|
| controller → voice | `POST /calls {callId, to, from, language}` → `{providerCallId}` | service token. Same `callId` again returns the same call (`duplicate: true`). `429` at `MAX_CONCURRENT_CALLS`, `503` with `missing: [...]` when not configured, `403` for a non-test number on Twilio, `502` when the provider refuses. |
| controller → voice | `POST /calls/{callId}/hangup` | ends a live call now, or stops a ringing one. |
| voice → controller | `GET /api/internal/outreach/voice-config` | provider settings (below). |
| voice → controller | `GET /api/internal/outreach/calls/{callId}/session` | fetched while the phone rings. Optional extras read: `testNumbers`, `fillers`, `apology`, `consentWhatsApp`. |
| voice → controller | `POST .../calls/{callId}/tools/{tool} {args}` → `{ok, say, end?, redialLanguage?}` | |
| voice → controller | `POST .../calls/{callId}/events {type, at, data}` | below. |
| k8s → voice | `GET /healthz`, `GET /readyz` | liveness (always 200, with `ready`); readiness: 503 until the call path and the Silero VAD and Smart Turn models are preloaded at startup, so the first call after a deploy doesn't greet late. |

Auth both ways is the repo's service token (`packages/service-auth`, HMAC with `SERVICE_AUTH_SECRET`); outbound
tokens carry `{service: "voice", tenantId: <platform>, internal: true, callId}`.

**Events.** `ringing` (the provider took the call), `answered`, `transcript` (batches of `{role, text, at}` turns,
every 6 turns or 10 s), then exactly **one terminal event**, with `data.terminal: true`:

| Terminal | When | `data` |
|---|---|---|
| `no_answer` | not picked up within 35 s, or cancelled | `reason` |
| `busy` | the provider says busy | `reason` |
| `voicemail` | voicemail/IVR detected; no message is left | `durationS`, `transcript`, `recordingKey` |
| `ended` | a normal call | `durationS`, `durationSource`, `transcript`, `recordingKey`, `redialLanguage?` |
| `error` | the provider failed the call, or STT/TTS/LLM broke mid-call, or a restart | `reason` (+ the above when answered) |

The provider's record decides that a call ended: an answered call's terminal event waits for the provider's terminal
callback (its duration wins) *and* for the pipeline (transcript, recording). If one of the two never arrives, the
event goes out 30 s later with what is known (`durationSource: "local"`, `providerStatus: "missing"`).
`redialLanguage` on `ended` asks the controller to ring back in that language (the `switchLanguage` tool).

## How a call behaves

- **Greeting first.** 0.4 s after the media stream opens, the session `greeting` plays. It is not interruptible,
  because it carries the recording notice.
- **Recording consent.** Nothing is recorded until the greeting has played to the end (`recording.py`,
  `RecordingGate`); then both sides are recorded, mixed to mono, encoded to MP3 and stored at
  `[S3_KEY_PREFIX/]outreach/recordings/{callId}.mp3`.
- **Barge-in.** The user turn starts on Silero VAD speech after `VOICE_VAD_START_S` (0.2 s) and interrupts the bot.
- **Turn-taking.** End of turn is semantic (Smart Turn v3): after `VOICE_TURN_SILENCE_S` (0.48 s) of silence the model
  judges whether the sentence is finished; "my shop is called… um" is held for up to `VOICE_TURN_MAX_WAIT_S` (2 s).
- **Fillers.** A tool call that takes longer than 1.8 s plays a filler ("one moment" in the call's language). If the
  reply to a turn hasn't started 3 s after the person stopped, a filler plays too. Fillers and the failure apology go
  straight to TTS, so an LLM that is stuck can't hold them up, and a filler never counts as the reply. A turn in which
  nothing was transcribed (a cough, noise) owes no reply.
- **Tools.** The controller's `say` is spoken verbatim and the LLM isn't asked again. `end` hangs up after the speech.
  `redialLanguage` ends the call and is reported in `ended`. **No false success:** when the controller errors or times
  out, Claude sees `ok: false` with an instruction not to claim it worked.
- **Silence.** After `silenceS` (session, 14 s) of silence Claude checks in ("are you still there?"); after a second
  silence it says a short goodbye and hangs up.
- **Voicemail / IVR.** In the first 8 s after answer: a beep (a sustained pure tone), a monologue longer than 6.5 s,
  or voicemail/operator/IVR phrases (English and Indian languages) end the call at once with `voicemail`, leaving no
  message (`voicemail.py`). Whichever signal decides, the call ends once, even if it was already saying goodbye.
- **Failure.** The agent apologises in the call's language and ends with one `error` (its `reason` says what broke) when:
  - STT breaks: a processor stops being usable, 3 STT errors with no transcript between them, or a turn of 1.5 s or
    more of speech (or any speech after an STT error) that never gets a transcript (`stt_error` / `stt_timeout`);
  - the LLM breaks: any LLM error (the SDK has already retried), a completion timeout, or no first token within 8 s
    (`llm_error` / `llm_timeout`);
  - no reply has started 9 s after the person's turn (`no_reply`).

  The apology is the session's `apology` if given, else "sorry, the line's breaking up, we'll call you back later";
  it promises a WhatsApp message only when the session says `consentWhatsApp: true`. If TTS is what broke, it hangs
  up straight away.
- **Limits.** `maxDurationS` from the session (a polite goodbye), a hard `TimeLimit` at the provider
  (`VOICE_MAX_CALL_S`, 900 s), a 35 s ring timeout, and `MAX_CONCURRENT_CALLS`.
- **Restarts.** In-flight call ids are kept in `VOICE_STATE_DIR` (an emptyDir in k8s). On SIGTERM every live call is
  ended and reported as `error` (`reason: "restart"`); after a crash, the next process reports the ones it finds.
- **Logs.** JSON lines, phone numbers masked (`+91******3210`). Transcripts appear only at `LOG_LEVEL=DEBUG`. The
  voice-config response is never logged.

## Configuration

**Primary source: admin Settings → Providers.** The controller serves it at
`/api/internal/outreach/voice-config`; it is fetched when a call starts, cached for 60 s in memory only, and each field
falls back to its env var below when the endpoint is unreachable or leaves the field empty. With neither, `/calls`
refuses with `503` and lists what is missing.

| Env | Default | Purpose |
|---|---|---|
| `SERVICE_AUTH_SECRET` | (required) | the shared service-token secret (alias: `SERVICE_TOKEN_SECRET`) |
| `CONTROLLER_URL` | (required) | e.g. `http://jeffi-stores-controller-service.jeffi.svc.cluster.local:3000` |
| `PUBLIC_BASE_URL` | (required) | `https://voice.jeffistores.in`: status callbacks and Twilio's stream URL are built from it |
| `TELEPHONY_PROVIDER` | `exotel` | fallback for `voice_provider` (`exotel`, or `twilio` = test only) |
| `MAX_CONCURRENT_CALLS` | `2` | per pod |
| `TEST_NUMBERS` | | comma-separated E.164; joined with the Providers tab's test numbers (Twilio allowlist) |
| `EXOTEL_SID`, `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`, `EXOTEL_SUBDOMAIN` (`api.in.exotel.com`), `EXOTEL_APP_ID`, `EXOTEL_CALLER_ID` | | Exotel fallbacks |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VOICE_FROM` | | Twilio fallbacks (test calls only) |
| `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_WORKSPACE_ID`, `ANTHROPIC_SERVICE_ACCOUNT_ID`, `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_IDENTITY_TOKEN_FILE` | | Claude via workload identity federation (preferred); the first four override the controller's `anthropicIdentity` field by field, the token file is always local |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | region `centralindia` | Azure AI Speech key and region (fallbacks for `azureSpeech.apiKey` / `.region`) |
| `VOICE_STT_PROVIDER` / `VOICE_TTS_PROVIDER` | `sarvam` | fallbacks for `speech.sttProvider` / `.ttsProvider` (`sarvam` or `azure`) |
| `SARVAM_API_KEY`, `ANTHROPIC_API_KEY` | | key fallbacks (the Anthropic key only if federation isn't set up) |
| `VOICE_LLM_MODEL` | `claude-haiku-5-5` | fallback for `llmModel` |
| `VOICE_STT_MODEL` / `VOICE_TTS_MODEL` | `saaras:v3` / `bulbul:v3` | fallbacks for the Sarvam models |
| `S3_BUCKET` (or `S3_BUCKET_NAME`), `S3_KEY_PREFIX`, `AWS_REGION` | | recordings; unset bucket = no recording |
| `VOICE_WS_KEY` | | if set, `/ws/exotel` requires `?k=<key>` |
| `VOICE_STATE_DIR` | `/tmp/voice-service` | in-flight call ids, for restart reporting |
| `SM_SECRET_ID` | | optional: fill unset env keys from a Secrets Manager JSON secret, like the Node services |
| `VOICE_LLM_FIRST_TOKEN_S` | `8` | no first token from the LLM by then: apologise and end (`llm_timeout`) |
| `VOICE_STT_MISS_SPEECH_S` | `1.5` | a turn with this much speech and no transcript means STT isn't answering (`stt_timeout`) |
| `LOG_LEVEL` | `INFO` | `DEBUG` logs transcripts |

Voice per call: the session's `persona.voiceId`, else the Providers tab's `sarvam.voices[language]`, else Bulbul's
default.

## Founder setup checklist

1. **Exotel (production).** In admin Settings → Providers:
   - account SID, API key and API token, and the subdomain (`api.in.exotel.com` for the Mumbai cluster);
   - the virtual number: a **140-series ExoPhone**, as `callerId`;
   - an **App Bazaar flow** (its app ID as `appId`): `[Voicebot applet] → [Hangup applet]`. Set the Voicebot (AgentStream)
     applet's stream URL to `wss://voice.jeffistores.in/ws/exotel?k=<VOICE_WS_KEY>`, bidirectional, 8 kHz.
     Exotel has no API to end a live call: the agent hangs up by closing that socket, so the flow must continue to
     a Hangup applet;
   - status callbacks need nothing in Exotel's dashboard: each call passes its own
     `https://voice.jeffistores.in/telephony/exotel/status/{callId}?t=<token>` (events `answered` and `terminal`, JSON).
   - DLT: Jeffi as Principal Entity on DLT, with AI/automated calls declared (plan §7).
2. **Twilio (test calls only).** Twilio can't place compliant promotional calls in India (foreign caller ID, no
   140-series), so with `twilio_test` selected `/calls` refuses every number that isn't on the test allowlist (the
   Providers tab's test numbers, `TEST_NUMBERS`, or the session's `testNumbers`), and an empty allowlist refuses
   everything. Set the account SID, auth token and a Twilio voice number as `from`.
3. **Sarvam** API key, and optionally a voice per language. **Claude** through federation (next section); the
   Anthropic API key in Providers is only a fallback.
4. **Secret.** `kubectl -n jeffi create secret generic voice-service --from-literal=SERVICE_AUTH_SECRET=<the shared
   secret> --from-literal=VOICE_WS_KEY=<random>` (optionally the env fallbacks too).
5. **DNS.** An A record `voice.jeffistores.in` → the cluster IP, as `deploy/k8s/bootstrap/doc-hosts-dns.sh` does for the
   document hosts. Keep it off any CDN: the media WebSockets must reach Traefik directly. Keep `voice` reserved as a
   store slug.
6. **Turn it on.** Set `replicas: 1` in `deploy/k8s/platform/48-voice-service.yaml` and release. Until then the
   Deployment is applied at 0 replicas (a `kubectl scale` would be undone by the next release).

## Claude through federation

Calls reach Claude with Anthropic workload identity federation, not a key. The client is built with explicit
`WorkloadIdentityCredentials` (`llm_client.py`), so a stray `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` in the
environment cannot shadow it. The key is used only when no identity is configured. The identity ids come from the
controller's voice-config (`anthropicIdentity`: the platform's `ai_provider_identities` row plus its
`ANTHROPIC_ORGANIZATION_ID`), and the `ANTHROPIC_*` env vars override them field by field. `/calls` answers 503 and names what is
missing (`anthropic.identity.*`, `anthropic.identityTokenFile`, or `anthropic.identity-or-apiKey`).

The platform k3s's service-account tokens are not trusted by the existing federation rules, so the pod has a
`wif-minter` sidecar (`deploy/k8s/platform/48-voice-service.yaml`) that signs its own token: issuer
`https://wif-voice.jeffistores.in`, subject `jeffi-voice-service`, audience `https://api.anthropic.com`. It renews
`/wif/token` every 30 minutes (1 h lifetime), and the app reads it through `ANTHROPIC_IDENTITY_TOKEN_FILE`.

Founder steps:

1. **Keypair, off the repo.** `JEFFI_WIF_DIR=$HOME/.jeffi/wif-voice node ai-platform/scripts/local-wif-token.mjs jwk`
   creates `~/.jeffi/wif-voice/local-issuer.pem` and prints the public JWK (kid `jeffi-local-1`; the sidecar signs with
   that kid). Keep the PEM private.
2. **Issuer.** Anthropic Console, then Settings, Workload identity federation: add an issuer with URL
   `https://wif-voice.jeffistores.in`, an inline JWKS of `{"keys":[<the JWK from step 1>]}`.
3. **Federation rule.** Add a rule for that issuer: subject exactly `jeffi-voice-service`, audience
   `https://api.anthropic.com`, target the **flagship workspace's service account** (the platform row in
   `ai_provider_identities`, tenant `00000000-0000-0000-0000-000000000000`). The rule must be enabled for that
   workspace. The service account must already have API access there.
4. **Ids.** The controller serves the platform row of `ai_provider_identities` (the gateway's rule, which trusts the
   Razer and local issuers, not this one), so give voice-service its own ids in the `voice-service` Secret:
   `ANTHROPIC_FEDERATION_RULE_ID` (the rule from step 3) and, if they differ from the platform row,
   `ANTHROPIC_SERVICE_ACCOUNT_ID` and `ANTHROPIC_WORKSPACE_ID`. Env wins over the controller's ids; do not edit the
   platform row, the gateway uses it. Set `ANTHROPIC_ORGANIZATION_ID` there too (and on the controller, for the
   admin readiness check).
5. **Secret.** `kubectl -n jeffi create secret generic voice-service ... --from-file=wif-issuer.pem=$HOME/.jeffi/wif-voice/local-issuer.pem`
   (or `kubectl patch`/re-create the existing Secret so it keeps `SERVICE_AUTH_SECRET` and `VOICE_WS_KEY`). Optionally add
   `ANTHROPIC_ORGANIZATION_ID` to it as the env fallback.
6. Set `replicas: 1` and release. The sidecar log line `wif token renewed` confirms the key is mounted.

## Local development

```bash
cd voice-service
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
.venv/bin/python -m pytest            # or, from the repo root: python -m pytest voice-service
```

A real test call (your own phone only):

1. Tunnel port 8080 (`cloudflared tunnel --url http://localhost:8080` or `ngrok http 8080`) and use its `https://` URL
   as `PUBLIC_BASE_URL`. For Exotel, point a *test* flow's Voicebot applet at `wss://<tunnel>/ws/exotel`.
2. Run the controller locally (`CONTROLLER_URL=http://localhost:3013`) with the same `SERVICE_AUTH_SECRET`, or set the
   provider env fallbacks directly.
3. Start: `PYTHONPATH=src .venv/bin/python -m voice_service.app` (listens on :8080).
4. Place the call through the controller's test-call mode (only `test_numbers`), or by hand with a service token
   (`voice_service.auth.sign_service_token`). With `TELEPHONY_PROVIDER=twilio`, only allowlisted numbers ring.

## Cost model (per connected minute, estimates: check current price sheets)

| Part | Basis | ≈ ₹/min |
|---|---|---|
| Exotel | outbound per-minute + AgentStream streaming (plan-dependent) | 0.6–1.2 |
| Sarvam STT (saaras) | ~₹30 per audio hour, the caller's side streamed | ~0.5 |
| Sarvam TTS (bulbul) | per character; ~350 spoken characters a minute | ~0.5 |
| Claude Haiku 5.5 | ~6 turns/min; the system prompt is cached, so mostly small uncached deltas + ~60 output tokens a turn | <0.05 |
| **All-in** | | **~1.7–2.3** (plan target ₹1.7–2.4) |

Unanswered and voicemail calls cost only the ring/answer seconds: voicemail is cut within 8 s.

## Latency tuning knobs

| Env | Default | Effect |
|---|---|---|
| `VOICE_VAD_START_S` | 0.2 | speech needed to start a user turn / barge in; lower = snappier interruptions, more false barge-ins on noise |
| `VOICE_TURN_SILENCE_S` | 0.48 | silence before the end-of-turn model runs; the main lever on response time |
| `VOICE_TURN_MAX_WAIT_S` | 2.0 | longest wait when the sentence sounds unfinished (was 3.0; see docs/OUTREACH_E2E.md for the measurement) |
| `VOICE_GREETING_DELAY_S` | 0.4 | pause after answer before the greeting |
| `VOICE_FILLER_AFTER_S` | 1.8 | tool wait before "one moment" |
| `VOICE_DEAD_AIR_S` | 3.0 | late reply before a filler |
| `VOICE_LLM_EFFORT` | `low` | Haiku 5.5 effort (no extended thinking; `low` is the documented fastest setting for it — disabling thinking makes it narrate tool decisions aloud) |
| `VOICE_LLM_MAX_TOKENS` | 400 | caps a runaway turn |
| `VOICE_STT_MODE` | `transcribe` | `codemix` for heavily mixed speech |
| `VOICE_TTS_MODEL` | `bulbul:v3` | `bulbul:v4-flash` trades voice choice for lower latency |

The audio path runs at 16 kHz in, 8 kHz out (telephony). Keep the pod near the providers (ap-south-1 for Sarvam and
Exotel's Mumbai cluster) to save round trips.

## Compliance (plan §0)

- The persona has a human name, never claims to be human, and answers truthfully if sincerely asked; that lives in the
  controller's prompt.
- Recording is announced in the greeting and nothing is recorded before it has played.
- The controller enforces the calling window (09:30–20:30 IST), DND/NCPR, the suppression list, 3 attempts, the lead
  `source`, and consent before WhatsApp. This service adds: no message on voicemail, STOP/opt-out via the `optOut`
  tool (with `end`), and Twilio never reaching a real lead.
- Every call reaches the controller's audit log through its events.

## Deploy and CI

- Image: `voice-service/Dockerfile` (python:3.12 slim, arm64), built from the repo root by
  `deploy/k8s/bootstrap/build-push-ecr.sh voice <tag>`, in CI's `build` (PR, not pushed) and `images` (release) jobs,
  and in `release.sh`.
- k8s: `deploy/k8s/platform/48-voice-service.yaml` (Deployment at 0 replicas, Service, IngressRoute for
  `voice.jeffistores.in`), in the platform kustomization; the rollout pins its image to the release tag.
- CI: the `voice` job runs `python -m pytest voice-service` when `voice-service/` changes (and on every release);
  `pip-audit` checks `requirements.txt` in the Security job.
- Dependencies: `requirements.in` → `requirements.txt` (uv, pinned, resolved two weeks back):
  `uv pip compile voice-service/requirements.in --universal --python-version 3.12 --exclude-newer <date> --annotation-style line -o voice-service/requirements.txt`
  (not `--only-binary :all:`: pipecat's num2words needs docopt, which ships as an sdist only)
  (and the same for `requirements-dev.in`).
