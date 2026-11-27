# Outreach agent: tools + skills

Status: built 2026-11-27 on `feat/feature-release`. Replaces the hard-coded showcase-offer script (prompt.ts
`systemPrompt`, the 9 voice tools in `tools.ts`, the 3-tool WhatsApp assistant in `inbound.ts`).

Outreach used to be one fixed pipeline: call, ask for WhatsApp consent, build the Showcase site on the call, publish,
then answer WhatsApp. The steps and wording were in code. Now:

- **Tools** (code): every capability is a typed tool with a zod schema and server-side enforcement. The hard limits
  live in the tools and in `agent/guards.ts`, so no skill can switch them off.
- **Skills** (written by the admin): a Markdown file, with optional frontmatter, that says how to approach and talk to
  the lead: the flow (one call, two calls, WhatsApp only), tone, language, what to offer and when, and which tools are
  allowed. Skills are versioned, stored per store, chosen per campaign (list), and validated and previewed before use.
- **Runtime**: when a run starts for a contact, the agent is built from the resolved skill version plus its allowed
  tools. It drives the conversation through tools on voice (voice-service, real time) and on WhatsApp and follow-ups
  (the AI gateway), across turns and days.

Outreach stays flagship-only (platform admins, platform-only tables in the flagship DB). "Per store" is a `tenant_id`
on `outreach_skills`, NULL for the flagship; nothing else is tenant-scoped yet.

## 1. Tool catalog

`controller-service/src/lib/outreach/agent/catalog.ts` registers every tool. A tool is a `ToolDef`
(`agent/types.ts`): name, description, channels, effect (read / write / send / call), zod args, the JSON Schema the
LLM sees, and a handler that returns a `ToolResult` (`ok`, `say`, `end`, `redialLanguage`, `data` for the LLM,
`error`, `detail` for the audit row only).

Every invocation goes through `agent/invoke.ts` `invokeTool()`:

1. the tool exists, and the skill allows it on this channel (or it is mandatory);
2. the args parse;
3. the contact gate (opted out, suppressed) refuses every side effect except `optOut`, `handOff`, `logOutcome`;
4. the handler runs; it calls the existing services (build.ts, whatsapp.ts, voice-client.ts, state.ts), which keep
   their own checks (consent, the 24 h window, the state machine, MAX_BUILDS);
5. a `tool_call` outreach event records `{tool, channel, runId, args, ok, say, end, error, detail}`.

Names stay camelCase, and the 9 voice tools keep their names, so voice-service, transcripts, `knownBrief()` (which
reads `addDetails` events) and the E2E harnesses keep working.

| Tool | Channels | Effect | Wraps | Notes |
|---|---|---|---|---|
| `getLead` | voice, whatsapp, follow_up | read | contacts, `knownBrief` | business, owner first name, category, city, language, status, consent, attempts, known brief, site state, window open, last call outcome. Phone masked to the last 4 digits. |
| `updateLead` | all | write | `outreach_contacts` | owner_name, language, category, city, a note (into `extra.notes`). Never status. |
| `recordConsent` | voice, whatsapp | write | today's handler | evidence cites the run's skill ref instead of the constant `SCRIPT_VERSION` (the builtin default still cites `showcase-offer/2026-11-24.1`). |
| `optOut` | all | write | `applyOptOut` (voice), `inbound.optOut` (WhatsApp) | **mandatory**. Ends a call. |
| `markOutcome` | all | write | today's handler | not_interested / wrong_number / other. Ends a call on voice. |
| `logOutcome` | all | write | `outreach_events` `agent_note` | a structured note (outcome, note, tags); ends nothing. |
| `handOff` | all | write | contact `handoff_at/handoff_reason`, run → `handed_off`, pending tasks cancelled | **mandatory**. The agent stops: no automatic WhatsApp replies or follow-ups until an admin resumes. Ends a call. |
| `getSiteStatus` | all | read | build state, brief | draft / building / ready / published / claimed, what is missing. |
| `startPreview` | voice, whatsapp, follow_up | send | `build.startDraft` + `preview_ready` template | today's composite; needs consent; follow_up so a WhatsApp-only kickoff can start the draft. |
| `addDetails` | voice, whatsapp | write | `build.mergeBrief` | the generation input; starts generation when the brief is ready. |
| `requestChange` | voice, whatsapp | write | `build.requestChange` | |
| `publishSite` | voice, whatsapp | send | `build.publish` + `site_live` + `claim` templates | needs consent; over the template limit the site still goes live and the links wait for the team. |
| `sendLink` | all | send | `preview_ready` / `site_live` / `claim` template | the URL is derived on the server (a fresh preview link from `build.startDraft`, the live URL, a new claim token); the LLM never sees a claim link. |
| `sendWhatsAppTemplate` | all | send | `sendOutreachTemplate` | `details_needed` (with `missing`), `callback` (with the booked time), `trial_ending`; button URL derived on the server. |
| `sendWhatsAppText` | whatsapp, follow_up | send | `sendOutreachText` | free text, only inside the 24 h window. On a WhatsApp turn the final reply is sent automatically; this is for follow-ups. |
| `readMessages` | all | read | `outreach_messages` | the last N messages (in/out), claim links masked. |
| `placeCall` | whatsapp, follow_up | call | agent task `call`, due now (clamped to the window) | "call me now" on WhatsApp; the scheduler dials within a minute. |
| `scheduleCallback` | voice, whatsapp, follow_up | call | before interest: today's status `callback` + `next_attempt_at`; engaged contact: an agent task `call` | ends a call. |
| `scheduleFollowUp` | all | write | agent task `whatsapp_turn` | the agent wakes at that time on the follow_up channel with the instruction it left itself. |
| `endCall` | voice | write | call outcome | the agent says goodbye first, then ends the call. |
| `switchLanguage` | voice | write | today's handler | ends the call and rings back in that language. |

`say` lines stay in `prompt.ts` `LINES` (9 languages): success is only ever claimed by a line from code after the
action worked. A refusal from build.ts is mapped exactly as before (`buildRefusal`).

voice-service: the tool reply now carries `data` and `error` through to the LLM (`tools.py` `to_outcome`,
`controller.py` `ToolResult`), so read tools work on calls too.

## 2. Skill format

A skill is UTF-8 Markdown, at most 24 KB, with optional YAML frontmatter (a small subset: scalars, `[a, b]` lists,
`- item` lists, one level of nested maps).

```markdown
---
name: showcase-two-call            # slug, a-z0-9 and -, unique per store
title: Showcase offer, two calls
description: First call gets consent and starts the preview; a second call next day finishes and publishes.
flow: two_call                     # one_call | two_call | whatsapp_only
channels: [voice, whatsapp]        # the live channels (follow_up comes from a "## Follow-up" section)
languages: [en, hi, ta]            # what the agent may speak; default: all 9
default_language: en
persona:                           # a human name per language; missing ones use the code default
  en: Priya
  hi: Priya
tone: warm, plain, unhurried
tools:                             # a list (every channel) or a map per channel
  voice: [recordConsent, startPreview, addDetails, scheduleCallback, markOutcome, switchLanguage]
  whatsapp: [addDetails, requestChange, getSiteStatus]
  follow_up: [sendLink, sendWhatsAppTemplate, scheduleCallback, logOutcome]
limits:                            # may only lower the hard limits
  max_agent_calls: 2
  max_templates_per_day: 3
---

Shared guidance for every channel goes here, before the first channel heading.

## Voice
How to run a call. Placeholders: {{business}}, {{owner}}, {{persona}}, {{city}}, {{category}}, {{language}},
{{now_ist}}, {{pitch}}, {{consent_ask}}, {{ai_answer}}, {{trial_days}}.

## WhatsApp
How to answer the owner's messages.

## Follow-up
What to do when a scheduled follow-up fires or a call ends: act only through tools.
```

Frontmatter keys accept snake_case or camelCase. The parsed form is `SkillMeta` / `ParsedSkill` in `agent/types.ts`.

**Validation** (`agent/skill/validate.ts`) returns errors (block saving) and warnings:

- errors: unreadable frontmatter, unknown `flow`, unknown channel or language, a tool not in the catalog, a tool on a
  channel it cannot run on, a limit that is not a positive integer, no channel section for a channel the skill lists,
  a voice flow without a voice section, `whatsapp_only` listing voice, over the size cap, an instruction to deny being
  an AI or to claim to be human ("say you are human", "never admit you are an AI", "pretend to be a person", ...);
- warnings: an unknown placeholder, a limit above the hard limit (it is clamped), a voice skill with no call-ending
  tool (`markOutcome`, `endCall`, `scheduleCallback`), a phone number or email in the text (PII), a follow-up section
  with no sending tool.

**Preview** renders the exact system prompt, greeting and tool list the agent would get for a channel, a language and
a sample (or real) contact, with no AI call.

**Builtin skills** (`agent/skill/builtin.ts`): `showcase-offer` (the default; today's flow, migrated word for word),
`showcase-two-call` and `showcase-whatsapp-only` (templates to start from). The default renders the voice system
prompt byte-for-byte the same as the old `systemPrompt()`; a test holds that.

## 3. Runtime

```
contact due (worker) ──▶ ensureRun(contact): open run, or resolve the skill and pin its version
   │
   ├─ voice ── voice-service GET session ──▶ buildVoiceSession: render(skill, voice) + tools(skill, voice) + greeting
   │            voice-service POST tools/{tool} ──▶ invokeTool(channel voice)
   │            voice-service POST events (ended) ──▶ settleContact (as before) ──▶ onCallEnded: a follow-up task now
   │                                                                               if the skill has a Follow-up section
   ├─ whatsapp ── webhook ──▶ routeOutreachWhatsApp: STOP keywords first (code), then runAgentTurn(whatsapp)
   │               gateway loop (≤4 model calls) ──▶ invokeTool(channel whatsapp) ──▶ reply sent as free text
   │
   └─ follow_up ── cron (outreach-calls) ──▶ runDueAgentTasks: call → dialAgentCall; whatsapp_turn → runAgentTurn(follow_up)
```

- **Skill resolution** (`skill/store.ts` `resolveSkillForContact`): the list's pinned version, else the list's skill's
  current version, else the program's default skill, else the builtin `showcase-offer`. A run pins the version, so a
  conversation that spans days keeps the playbook it started with.
- **Runs** (`outreach_agent_runs`): one open run per contact (`active` or `handed_off`). Counts turns and gateway
  spend.
- **Tasks** (`outreach_agent_tasks`): `call` (a follow-up call to an engaged contact) and `whatsapp_turn` (wake the
  agent). The outreach-calls cron runs the dialler, then the due tasks.
- **Voice** stays in voice-service (Pipecat, Sarvam, Claude in real time). The controller only changes what the
  session says: the system prompt from the skill, the skill's voice tools, the persona from the skill. The greeting,
  with its recording notice, stays in code.
- **WhatsApp and follow-ups** run through `agent/model.ts`: `aiChat` on the AI gateway (feature `outreach_agent`,
  `cacheNamespace: 'platform'`, so flagship-metered at `ai_price_list` prices). Tests and the E2E inject a scripted
  model with `setAgentModel()`.
- **Agent calls** (`dialAgentCall`) dial an engaged contact without moving its status (like the language redial), so
  inbound WhatsApp keeps routing to outreach. Unanswered agent calls wake the agent (`call_unanswered`) when the skill
  has a follow-up section.
- **WhatsApp-only**: the worker does not dial a contact whose skill is `whatsapp_only`. With recorded WhatsApp consent
  it moves the contact to `interested` and schedules a follow-up turn now; without consent it skips it with an event
  (WhatsApp never goes first without consent).

### Rendering

`skill/render.ts` builds each prompt from code parts and the skill:

- voice: identity line, LANGUAGE (only the skill's languages; the switchLanguage sentence only when it is allowed),
  WHO YOU ARE (the persona rule, always), the skill's preamble and Voice section, WHERE THINGS STAND, script version;
- whatsapp: identity, stage, reply language, the safety lines, the skill's preamble and WhatsApp section, state;
- follow_up: identity ("act only through tools; nothing you write is sent"), the trigger, the safety lines, the
  skill's preamble and Follow-up section, state.

## 4. Safety model (hard limits in code)

| Limit | Where |
|---|---|
| Persona: a human name, never denies being an AI, never claims to be human; the recording notice before recording | WHO YOU ARE block in every prompt (not part of the skill); validation rejects skills that say otherwise; WhatsApp replies that deny being an AI are replaced with the `aiAnswer` line and logged; the greeting stays in code |
| Consent before any WhatsApp | whatsapp.ts refusal (unchanged); `startPreview`, `publishSite`, `sendLink`, templates |
| Opt-out | STOP keywords before the agent (inbound.ts); `optOut` mandatory on every channel; the contact gate refuses every side effect after it; suppression list |
| Calling hours 09:30–20:30 IST, DND, suppression, at most 3 unanswered attempts | worker (unchanged); `placeCall`, `scheduleCallback`, `dialAgentCall` clamp to the window and refuse DND / suppressed |
| Rate limits | `guards.ts` `HARD_LIMITS` (every send tool, the legacy call tools included): templates 6/day and 12/week per contact, texts 20/day, gateway turns 30/day, agent calls 3 in total and 2 per day, 3 pending tasks, tasks 15 min to 30 days ahead; skill limits can only lower them |
| Spend | gateway turns stop at ₹20 per contact per day and ₹500 for the program per day (`maxSpendPaise*`); over the cap the run is handed off |
| PII | tool `data` masks phones, never carries claim links or tokens; audit rows mask claim links (unchanged); skill text is checked for phone numbers and emails |
| AI routing | WhatsApp and follow-up turns go through the gateway with flagship pricing. voice-service's real-time Claude and Sarvam streaming stays the known exception (founder rule of 2026-11-26), flagship-only and not metered to stores |
| Hand-off | `handOff` is mandatory; a handed-off run gets no automatic turns until an admin resumes it |

## 5. Data model

All platform-only (flagship DB), in `controller-service/database/platform-only/` (no migration: new tables and columns).

- `outreach_skills`: id, tenant_id (NULL = flagship), program, slug (unique per tenant), title, description,
  current_version_id, archived_at, created_by, timestamps.
- `outreach_skill_versions`: id, skill_id, version (unique per skill), content, meta (parsed frontmatter), sha256,
  validation, source (upload | builtin), created_by, created_at.
- `outreach_agent_runs`: id, contact_id, skill_version_id (NULL for a builtin), skill_ref, status (active |
  handed_off | completed | stopped; one open per contact), turns, spend_paise, last_channel, last_turn_at, notes,
  started_at, updated_at, ended_at.
- `outreach_agent_tasks`: id, run_id, contact_id, kind (call | whatsapp_turn), due_at, reason, instruction, status
  (pending | running | done | cancelled | failed), attempts, result, created_by, created_at, done_at.
- `outreach_lists.skill_id`, `outreach_lists.skill_version_id` (the campaign's skill, optionally pinned);
  `outreach_program_state.default_skill_id`; `outreach_contacts.handoff_at`, `handoff_reason`.

## 6. Admin

Outreach gets a **Skills** tab: the skills with their current version and the lists using them; upload a `.md` file
or paste one, validated as you type; save as a new skill or a new version; set the current version; archive; download
a builtin as a starting point; preview a channel for a language and a contact. The Lists tab picks each list's skill
(and an optional pinned version); the Program tab picks the default skill. A contact's page shows its run (skill ref,
status, turns, spend), its tasks, and hand-off / resume.

APIs (all `outreachGuard`, `ecom_outreach:read|write`):

- `GET/POST /api/admin/ecom/outreach/skills`, `POST .../skills/validate`, `POST .../skills/preview`
- `GET/PATCH/DELETE .../skills/[id]`, `POST .../skills/[id]/versions`
- `GET .../catalog` (the tool catalog for the UI)
- `PATCH .../lists/[id]` (skill_id, skill_version_id), `PATCH .../program` (default_skill_id)
- `PATCH .../contacts/[id]` gains `agent: 'resume' | 'handoff'`; `GET .../contacts/[id]` gains `agent: {run, tasks}`

## 7. Tests and the end-to-end run

- Unit: frontmatter parsing, validation, rendering (the default skill equals the old voice prompt), each tool's
  guard, invokeTool's allow-list and gates, the runtime loop with a scripted model.
- `controller-service/integration-tests/api-db/outreach-agent-e2e.test.ts` (jeffi_test): a two-call skill drives one
  test contact through call 1 (consent, preview, details, a callback booked), WhatsApp (details and a change), the
  scheduler's second call (publish), with the real routes and tables, a scripted model, voice-service replaced by
  direct calls to the session, tools and events routes, and WhatsApp in capture mode. Nothing is dialled or sent.

## 8. Module ownership (as built)

| Module | What |
|---|---|
| `agent/types.ts` | the shared contracts |
| `agent/limits.ts`, `agent/guards.ts` | hard limits, gates, quotas, PII masking, the AI-denial check |
| `agent/catalog.ts`, `agent/tools/*.ts`, `agent/invoke.ts` | the tool catalog and the single entry point |
| `agent/runs.ts` | run and task SQL (create, turn accounting, hand-off, resume, tasks) |
| `agent/skill/*` | frontmatter, parse, validate, render, builtin skills, store and resolution |
| `agent/model.ts`, `agent/runtime.ts`, `agent/wa-lines.ts` | the gateway model, ensureRun, voice session, the turn loop, the scheduler, the WhatsApp lines and transcript |
| `tools.ts`, `session.ts`, `inbound.ts`, `call-events.ts`, `worker.ts` | thin wrappers over the runtime, same routes |

## 9. Decisions made while building (2026-11-27)

- Tool names stay camelCase and the 9 voice tools keep their names and schemas, so voice-service, `knownBrief()` and
  the harnesses keep working. Mandatory tools are `optOut` and `handOff` only, so the default voice session gains just
  `handOff`.
- Off voice, a tool's spoken line becomes `data.note` for the LLM; `end` and `redialLanguage` only mean something on
  a call. On a call, a spoken refusal carries no error code (the legacy reply bodies are unchanged).
- A callback booked for an engaged contact is an agent task, not a status move to `callback`, so inbound WhatsApp
  keeps routing to outreach while the second call is pending. Before interest, the dialler's retry path is unchanged.
- Skill validation and preview need only `ecom_outreach:read`: they write nothing (allow-listed in the write-scope
  audit next to the other preview endpoints).
- The greeting and the recording notice stay in code; a skill cannot change them.
- A skill with no WhatsApp section hands the contact to the team when they message, with the honest fallback line.

## 10. Open items

- Voice LLM through the gateway: needs a streaming Messages endpoint on the gateway that voice-service can use without
  losing first-token latency. Until then voice stays the documented exception.
- Templates: only English and Hindi exist; other languages get the English copy (unchanged).
- A store-tenant outreach (non-flagship) needs tenant-scoped contacts and lists; the skills table is ready for it.
