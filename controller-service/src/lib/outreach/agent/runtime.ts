import { randomUUID } from 'crypto'
import { outreachPool } from '../db'
import { recordEvent } from '../events'
import { getProgramState } from '../program-state'
import { getProgram } from '../programs/_registry'
import { asLanguage, greeting, LINES, shopperGreeting } from '../prompt'
import { hadAnsweredCall, knownBrief, loadCallContext, MAX_DURATION_S, readVoiceSettings, SILENCE_S, type CallSession } from '../session'
import { InvalidTransitionError, transition } from '../state'
import { isSuppressed } from '../suppress'
import { LANGUAGES, type OutreachCall, type OutreachContact, type OutreachLanguage } from '../types'
import { VoiceServiceError, voiceServiceUrl } from '../voice-client'
import { sendOutreachText, windowOpen } from '../whatsapp'
import { callCounts, inCallingWindow, nextWindowTime, place } from '../worker'
import { allowedTools, llmSchemas } from './catalog'
import { agentCallQuota, deniesBeingAi, istDayStart, turnBudget } from './guards'
import { invokeTool } from './invoke'
import { cancelJob, completeJob, failJob, jobOfRun, liveJobOf, phoneBusy, setJobStatus, SHOWCASE_PROGRAM, toJob } from './jobs'
import { effectiveLimits } from './limits'
import { getAgentModel } from './model'
import * as runs from './runs'
import { personaNameFor, renderSystemPrompt, skillLanguage, STORE_NAME } from './skill/render'
import { loadJobSkill, loadRunSkill, resolveSkillForContact } from './skill/store'
import { shopperConsent } from './store/consent'
import type { AgentLimits, AgentModelRequest, AgentRunRow, AgentTaskRow, AgentTrigger, JobRow, RenderContext, ResolvedSkill } from './types'
import { fallbackLine, OPT_OUT_CONFIRMATION, transcript } from './wa-lines'

// The outreach agent's runtime (docs/plans/OUTREACH_AGENT_SKILLS.md §3): which skill a contact runs, the voice session
// from it, the WhatsApp / follow-up turn loop on the gateway model, the scheduler for the agent's own tasks, and the
// first-touch plan the dialler asks for. inbound.ts, call-events.ts and the cron call in here; this file never
// imports them (worker.ts reaches it through a dynamic import).

const MAX_ITERATIONS = 4
const WA_ACTOR = 'outreach:whatsapp'
const AGENT_ACTOR = 'outreach:agent'
const ENGAGED = new Set(['interested', 'building', 'preview_sent', 'published'])
const UNANSWERED = new Set(['no_answer', 'busy', 'voicemail', 'error'])
const RETRY_MS = 10 * 60_000
const JOB_RETRY_MS = 2 * 3600_000
const JOB_DEFER_MS = 15 * 60_000

const log = (msg: string, e: unknown) => console.error(`[outreach] ${msg}`, e instanceof Error ? e.message : e)

async function freshContact(id: string): Promise<OutreachContact | null> {
  const r = await outreachPool().query(`SELECT * FROM outreach_contacts WHERE id = $1`, [id])
  return r.rows[0] ?? null
}

async function stopped(c: Pick<OutreachContact, 'status' | 'opted_out_at' | 'phone'>): Promise<boolean> {
  return !!c.opted_out_at || c.status === 'opted_out' || c.status === 'suppressed' || (await isSuppressed(c.phone))
}

/** Where a contact's program settings (window, caps, test numbers) live: shopper contacts use the Showcase program's. */
export const settingsProgram = (contact: Pick<OutreachContact, 'program'>): string => (getProgram(contact.program) ? contact.program : SHOWCASE_PROGRAM)

/** A shopper contact runs its live job's agent; the job's latest run stands in when the job just ended (a late tool call). */
async function shopperRun(contact: OutreachContact): Promise<{ run: AgentRunRow; skill: ResolvedSkill; job: JobRow | null }> {
  const job = await liveJobOf(contact.id)
  if (job) {
    const skill = await loadJobSkill(job)
    if (!skill) throw new Error(`The agent of job ${job.id} no longer exists`)
    const run = await runs.createRun({ contactId: contact.id, skillVersionId: skill.versionId, skillRef: skill.ref, jobId: job.id })
    return { run, skill: run.skill_ref === skill.ref ? skill : await loadRunSkill(run), job: (await jobOfRun(run)) ?? job }
  }
  const last = (await outreachPool().query(`SELECT * FROM outreach_agent_runs WHERE contact_id = $1 ORDER BY started_at DESC LIMIT 1`, [contact.id])).rows[0] as AgentRunRow | undefined
  if (!last) throw new Error(`No job for shopper contact ${contact.id}`)
  return { run: last, skill: await loadRunSkill(last), job: await jobOfRun(last) }
}

/** The contact's open run, the skill it pinned and its job (task agents); a new run resolves and pins the skill now. */
export async function ensureRun(contact: OutreachContact, now: Date = new Date()): Promise<{ run: AgentRunRow; skill: ResolvedSkill; job: JobRow | null }> {
  void now
  const open = await runs.getOpenRun(contact.id)
  if (open) return { run: open, skill: await loadRunSkill(open), job: await jobOfRun(open) }
  if (contact.kind === 'shopper') return shopperRun(contact)
  const skill = await resolveSkillForContact(contact)
  const run = await runs.createRun({ contactId: contact.id, skillVersionId: skill.versionId, skillRef: skill.ref })
  // Another process may have opened the run first with a different skill.
  return { run, skill: run.skill_ref === skill.ref ? skill : await loadRunSkill(run), job: null }
}

// ---- voice ----

export interface VoiceAgentContext {
  call: OutreachCall
  contact: OutreachContact
  run: AgentRunRow
  skill: ResolvedSkill
  job: JobRow | null
  limits: AgentLimits
  language: OutreachLanguage
}

export async function voiceAgentContext(callId: string, now: Date = new Date()): Promise<VoiceAgentContext | null> {
  const ctx = await loadCallContext(callId)
  if (!ctx) return null
  const { run, skill, job } = await ensureRun(ctx.contact, now)
  return {
    call: ctx.call,
    contact: ctx.contact,
    run,
    skill,
    job,
    limits: effectiveLimits(skill.skill.meta.limits),
    language: skillLanguage(skill.skill, ctx.call.language ?? ctx.contact.language),
  }
}

/** The extra render context of a task-agent job (none for a Showcase lead, so its prompt stays as it was). */
const taskContext = (skill: ResolvedSkill, job: JobRow | null): Pick<RenderContext, 'audience' | 'inputs' | 'refs'> =>
  job ? { audience: skill.skill.meta.audience, inputs: job.inputs, refs: job.refs } : {}

/** What voice-service needs to run one call: the skill's prompt, tools and persona; the greeting stays in code. */
export async function buildVoiceSession(callId: string, now: Date = new Date()): Promise<CallSession | null> {
  const ctx = await voiceAgentContext(callId, now)
  if (!ctx) return null
  const { call, contact, skill, language, job } = ctx
  const shopper = skill.skill.meta.audience === 'shopper' && !!job
  const [{ settings }, testNumbers, known, continuing] = await Promise.all([
    readVoiceSettings(),
    getProgramState(settingsProgram(contact)).then(s => s.test_numbers ?? [], () => [] as string[]),
    shopper ? Promise.resolve({}) : knownBrief(contact.id),
    hadAnsweredCall(contact.id, call.id),
  ])
  const personaName = personaNameFor(skill.skill, language)
  const consentWhatsApp = !!contact.consent_whatsapp_at
  return {
    language,
    persona: { name: personaName, voiceId: settings.sarvam.voices[language] ?? '' },
    systemPrompt: renderSystemPrompt(skill.skill, {
      channel: 'voice',
      language,
      personaName,
      business: contact.business_name ?? '',
      owner: contact.owner_name,
      category: contact.category,
      city: contact.city,
      status: contact.status,
      now,
      continuing,
      consentWhatsApp,
      previewStarted: !!contact.showcase_site_id,
      published: contact.status === 'published' || contact.status === 'claimed',
      known,
      scriptVersion: skill.ref,
      ...taskContext(skill, job),
    }),
    greeting: shopper
      ? shopperGreeting({ language, personaName, store: STORE_NAME, name: contact.owner_name?.trim().split(/\s+/)[0] ?? null, continuing })
      : greeting({ language, personaName, business: contact.business_name, owner: contact.owner_name, continuing }),
    tools: llmSchemas(allowedTools('voice', skill.skill.meta.tools.voice)),
    maxDurationS: MAX_DURATION_S,
    silenceS: SILENCE_S,
    // voice-service's default apology promises a WhatsApp message; only make that promise with consent.
    apology: consentWhatsApp ? LINES[language].apologyWhatsApp : LINES[language].apologyCallBack,
    testNumbers,
    scriptVersion: skill.ref,
    skillRef: skill.ref,
  }
}

// ---- WhatsApp and follow-up turns ----

export type AgentTurnResult = { action: 'replied' | 'no_reply' | 'fallback' | 'paused' | 'budget' | 'opted_out'; reply?: string; tools: string[]; confirmed?: boolean }

function triggerText(t: AgentTrigger): string {
  switch (t.kind) {
    case 'follow_up':
      return `A scheduled follow-up fired${t.reason ? ` (${t.reason})` : ''}.${t.instruction ? ` Your note to yourself: ${t.instruction}` : ''}`
    case 'call_ended':
      return `The call just ended${t.outcome ? ` with outcome ${t.outcome}` : ''}.${t.summary ? ` Summary: ${t.summary}` : ''}`
    case 'call_unanswered':
      return `Your call was not answered (${t.status}).`
    default:
      return 'The contact sent a message.'
  }
}

/** One turn of the agent outside a live call: a WhatsApp reply, or a follow-up decision made through tools only. */
export async function runAgentTurn(input: { contact: OutreachContact; channel: 'whatsapp' | 'follow_up'; trigger: AgentTrigger; language?: OutreachLanguage; now?: Date }): Promise<AgentTurnResult> {
  const { contact, channel, trigger } = input
  const now = input.now ?? new Date()
  const wa = channel === 'whatsapp'
  const actor = wa ? WA_ACTOR : AGENT_ACTOR
  const lang = input.language ?? asLanguage(contact.language)
  const { run, skill, job } = await ensureRun(contact, now)

  if (run.status === 'handed_off' || contact.handoff_at) {
    await recordEvent(contact.id, 'agent_paused', { actor, data: { runId: run.id, channel, reason: contact.handoff_reason ?? 'handed_off' } })
    return { action: 'paused', tools: [] }
  }
  if (await stopped(contact)) return { action: 'opted_out', tools: [], confirmed: false }

  const limits = effectiveLimits(skill.skill.meta.limits)
  const handOffWith = async (reason: string): Promise<void> => {
    await runs.handOff({ contactId: contact.id, reason, channel, actor, now })
    if (wa) await sendOutreachText(contact.id, fallbackLine(lang), { actor }, now)
  }
  const budget = await turnBudget(contact, limits, now)
  if (budget) {
    await handOffWith(budget)
    return { action: 'budget', tools: [] }
  }
  if (!skill.skill.sections[channel]) {
    if (!wa) return { action: 'no_reply', tools: [] }
    await handOffWith('no_whatsapp_section')
    return { action: 'budget', tools: [] }
  }

  const meta = skill.skill.meta
  const personaName = personaNameFor(skill.skill, lang)
  const [known, continuing] = await Promise.all([job ? Promise.resolve({}) : knownBrief(contact.id), hadAnsweredCall(contact.id)])
  const system = renderSystemPrompt(skill.skill, {
    channel,
    language: lang,
    personaName,
    business: contact.business_name ?? '',
    owner: contact.owner_name,
    category: contact.category,
    city: contact.city,
    status: contact.status,
    now,
    continuing,
    consentWhatsApp: !!contact.consent_whatsapp_at,
    previewStarted: !!contact.showcase_site_id,
    published: contact.status === 'published' || contact.status === 'claimed',
    known,
    scriptVersion: skill.ref,
    trigger,
    windowOpen: windowOpen(contact, now),
    ...taskContext(skill, job),
  })

  const messages: AgentModelRequest['messages'] = await transcript(contact.id)
  if (!wa) {
    const note = `${triggerText(trigger)} Decide the next step through tools. Anything you write is not sent.`
    const last = messages[messages.length - 1]
    if (last && last.role === 'user') last.content += `\n\n${note}`
    else messages.push({ role: 'user', content: note })
  }

  const schemas = llmSchemas(allowedTools(channel, meta.tools[channel]))
  const model = getAgentModel()
  const used: string[] = []
  let text = ''
  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const last = iter === MAX_ITERATIONS - 1
      const r = await model({ system, messages, tools: last ? [] : schemas, channel, contactId: contact.id })
      await recordEvent(contact.id, 'agent_turn', { actor, data: { runId: run.id, channel, costPaise: r.costPaise } })
      await runs.recordTurn(run.id, channel, r.costPaise, now)
      if (!r.toolCalls?.length || last) {
        text = r.content ?? ''
        break
      }
      const calls = r.toolCalls.map((tc, i) => ({ ...tc, id: tc.id || `call_${iter}_${i}`, arguments: tc.arguments ?? {} }))
      messages.push({ role: 'assistant', content: r.content || '', tool_calls: calls, providerState: r.providerState })
      for (const tc of calls) {
        used.push(tc.name)
        const out = await invokeTool({
          channel,
          job,
          contact: (await freshContact(contact.id)) ?? contact,
          call: null,
          run,
          language: lang,
          now,
          actor,
          limits,
          scriptVersion: skill.ref,
          name: tc.name,
          args: tc.arguments,
          allowed: meta.tools[channel],
        })
        const { ok, data, error } = out
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ ok, ...(data ?? {}), ...(error ? { error } : {}) }).slice(0, 4000) })
        if (tc.name === 'optOut' && data?.optedOut) {
          let confirmed = false
          if (wa) confirmed = (await sendOutreachText(contact.id, OPT_OUT_CONFIRMATION[lang], { actor, optOutConfirmation: true }, now)).ok
          return { action: 'opted_out', tools: used, confirmed }
        }
      }
    }
  } catch (e) {
    log('assistant failed', e)
    await recordEvent(contact.id, 'whatsapp_assistant_failed', { actor, data: { error: e instanceof Error ? e.message : String(e), tools: used, channel } }).catch(() => {})
    if (!wa) return { action: 'fallback', tools: used }
    const reply = fallbackLine(lang)
    await sendOutreachText(contact.id, reply, { actor }, now)
    return { action: 'fallback', reply, tools: used }
  }

  let reply = text.trim()
  if (!wa) {
    if (reply) await recordEvent(contact.id, 'agent_follow_up', { actor, data: { runId: run.id, excerpt: reply.slice(0, 200), tools: used } })
    return { action: 'no_reply', tools: used }
  }
  if (!reply) return { action: 'no_reply', tools: used }
  if (deniesBeingAi(reply)) {
    await recordEvent(contact.id, 'ai_denial_blocked', { actor, data: { runId: run.id, excerpt: reply.slice(0, 200) } })
    reply = LINES[lang].aiAnswer
  }
  await sendOutreachText(contact.id, reply, { actor }, now)
  return { action: 'replied', reply, tools: used }
}

// ---- after a call ----

/** An engaged contact whose skill has a Follow-up section gets a follow-up turn once a call ends. Never throws. */
export async function onCallEnded(callId: string, type: string, now: Date = new Date()): Promise<void> {
  try {
    const pool = outreachPool()
    const c = await pool.query(`SELECT id, contact_id, answered_at FROM outreach_calls WHERE id = $1`, [callId])
    const call = c.rows[0] as { id: string; contact_id: string; answered_at: string | null } | undefined
    if (!call) return
    const contact = await freshContact(call.contact_id)
    if (contact?.kind === 'shopper') {
      const open = await runs.getOpenRun(contact.id)
      if (open?.job_id) return await onJobCallEnded(call, type, contact, open, now)
    }
    if (!contact || !ENGAGED.has(contact.status) || contact.handoff_at || (await stopped(contact))) return
    const run = await runs.getOpenRun(contact.id)
    if (!run || run.status !== 'active') return
    const skill = await loadRunSkill(run)
    if (!skill.skill.sections.follow_up) return
    let reason: string | null = null
    if (type === 'ended' && call.answered_at) reason = 'call_ended'
    else if (UNANSWERED.has(type) && !call.answered_at) {
      const agent = await pool.query(`SELECT 1 FROM outreach_events WHERE contact_id = $1 AND kind = 'agent_call' AND call_id = $2 LIMIT 1`, [contact.id, callId])
      if (agent.rows.length) reason = 'call_unanswered'
    }
    if (!reason) return
    await runs.scheduleTask({ runId: run.id, contactId: contact.id, kind: 'whatsapp_turn', dueAt: now, reason, instruction: `callId=${callId}`, createdBy: AGENT_ACTOR })
  } catch (e) {
    log('onCallEnded failed', e)
  }
}

/** A call of a task-agent job ended: retry an unanswered one, then the Follow-up section, then fail; an answered one the agent did not close waits for its follow-up or ends. */
async function onJobCallEnded(call: { id: string; answered_at: string | null }, type: string, contact: OutreachContact, run: AgentRunRow, now: Date): Promise<void> {
  const job = await jobOfRun(run)
  if (!job || job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'handed_off') return
  if (contact.handoff_at || (await stopped(contact))) return
  const skill = await loadRunSkill(run)
  const limits = effectiveLimits(skill.skill.meta.limits)
  const followUp = (reason: 'call_ended' | 'call_unanswered') =>
    runs.scheduleTask({ runId: run.id, contactId: contact.id, kind: 'whatsapp_turn', dueAt: now, reason, instruction: `callId=${call.id}`, createdBy: AGENT_ACTOR })
  if (UNANSWERED.has(type) && !call.answered_at) {
    if (job.attempts < limits.maxCallAttempts) {
      // Back in the queue for another try; the run ends so another job could use the phone meanwhile.
      await outreachPool().query(`UPDATE outreach_agent_runs SET status = 'stopped', updated_at = $2, ended_at = $2 WHERE id = $1 AND status = 'active'`, [run.id, now])
      await setJobStatus(job.id, 'queued', { dueAt: new Date(now.getTime() + JOB_RETRY_MS), now })
    } else if (skill.skill.sections.follow_up) {
      await followUp('call_unanswered')
      await setJobStatus(job.id, 'waiting', { now })
    } else await failJob(job.id, 'unreachable', 'call_unanswered', now)
    return
  }
  if (type !== 'ended' || !call.answered_at) return
  // Answered and ended without setOutcome: a pending callback or follow-up keeps the job waiting, otherwise it ends here.
  if ((await runs.pendingTaskCount(contact.id)) > 0) await setJobStatus(job.id, 'waiting', { now })
  else if (skill.skill.sections.follow_up) {
    await followUp('call_ended')
    await setJobStatus(job.id, 'waiting', { now })
  } else await completeJob(job.id, 'no_outcome', { actor: AGENT_ACTOR, now })
}

// ---- the agent's own tasks ----

const CALL_ID = /callId=([0-9a-f-]{36})/i

async function triggerFor(task: AgentTaskRow): Promise<AgentTrigger> {
  const fallback: AgentTrigger = { kind: 'follow_up', taskId: task.id, reason: task.reason, instruction: task.instruction }
  const callId = task.instruction?.match(CALL_ID)?.[1]
  if ((task.reason !== 'call_ended' && task.reason !== 'call_unanswered') || !callId) return fallback
  const r = await outreachPool().query(`SELECT id, status, outcome, summary FROM outreach_calls WHERE id = $1`, [callId])
  const call = r.rows[0] as { id: string; status: string; outcome: string | null; summary: string | null } | undefined
  if (!call) return fallback
  return task.reason === 'call_ended'
    ? { kind: 'call_ended', callId, outcome: call.outcome, summary: call.summary }
    : { kind: 'call_unanswered', callId, status: call.status }
}

export type DialAgentResult = { callId: string } | { reschedule: Date; reason: string } | { fail: string }

type DialFor = { kind: 'task'; task: Pick<AgentTaskRow, 'id'> } | { kind: 'job'; job: Pick<JobRow, 'id'> }

/** Calls this contact has had today (IST), whoever placed them. */
async function callsToday(contactId: string, now: Date): Promise<number> {
  const r = await outreachPool().query(`SELECT count(*)::int AS n FROM outreach_calls WHERE contact_id = $1 AND created_at >= $2`, [contactId, istDayStart(now)])
  return Number(r.rows[0]?.n ?? 0)
}

async function dialFor(contact: OutreachContact, what: DialFor, now: Date): Promise<DialAgentResult> {
  if (!voiceServiceUrl()) return { reschedule: new Date(now.getTime() + 30 * 60_000), reason: 'voice_not_configured' }
  const state = await getProgramState(settingsProgram(contact)).catch(() => null)
  if (!state?.enabled) return { fail: 'program_disabled' }
  if (!inCallingWindow(now, state)) return { reschedule: nextWindowTime(now, state), reason: 'outside_window' }
  if (contact.dnd_status === 'dnd') return { fail: 'dnd' }
  if (contact.status === 'suppressed' || (await isSuppressed(contact.phone))) return { fail: 'suppressed' }
  const { provider, settings } = await readVoiceSettings()
  const testMode = provider === 'twilio_test'
  if (testMode && !(state.test_numbers ?? []).includes(contact.phone)) return { fail: 'not_test_number' }
  const { skill } = await ensureRun(contact, now)
  const limits = effectiveLimits(skill.skill.meta.limits)
  // A job's first calls are counted by the job's attempts; only the agent's own scheduled calls use the lifetime quota.
  const quota = what.kind === 'task' ? await agentCallQuota(contact.id, limits, now) : (await callsToday(contact.id, now)) >= limits.maxAgentCallsPerDay ? 'call_limit' : null
  if (quota) return { fail: quota }
  const { today, active } = await callCounts(contact.program, now)
  if (state.daily_cap - today <= 0) return { reschedule: new Date(now.getTime() + RETRY_MS), reason: 'daily_cap' }
  if (state.concurrency - active <= 0) return { reschedule: new Date(now.getTime() + RETRY_MS), reason: 'concurrency' }
  const pool = outreachPool()
  const live = await pool.query(`SELECT 1 FROM outreach_calls WHERE contact_id = $1 AND ended_at IS NULL LIMIT 1`, [contact.id])
  if (live.rows.length) return { reschedule: new Date(now.getTime() + RETRY_MS), reason: 'call_in_progress' }

  const language = skillLanguage(skill.skill, contact.language)
  const callId = randomUUID()
  await pool.query(`INSERT INTO outreach_calls (id, contact_id, provider, language, status) VALUES ($1, $2, $3, $4, 'queued')`, [callId, contact.id, provider, language])
  await pool.query(`UPDATE outreach_contacts SET last_call_id = $2, updated_at = now() WHERE id = $1`, [contact.id, callId])
  // A task call is an 'agent_call' (counted by the quota); a job's call is a 'job_call'.
  await recordEvent(contact.id, what.kind === 'task' ? 'agent_call' : 'job_call', { callId, actor: AGENT_ACTOR, data: what.kind === 'task' ? { taskId: what.task.id, language } : { jobId: what.job.id, language } })
  try {
    await place(contact, callId, { language, actor: AGENT_ACTOR, from: testMode ? settings.twilioTest.from : settings.exotel.callerId, provider, test: testMode }, false)
  } catch (e) {
    // place() already marked a refused call failed; an unconfirmed one may still ring and settles through its events.
    if (e instanceof VoiceServiceError && e.refused) return { reschedule: new Date(now.getTime() + RETRY_MS), reason: 'dial_failed' }
  }
  return { callId }
}

/** Rings an engaged contact for a task: no status move, no attempt, like the language redial. */
export const dialAgentCall = (contact: OutreachContact, task: AgentTaskRow, now: Date): Promise<DialAgentResult> => dialFor(contact, { kind: 'task', task }, now)

export interface DueRun {
  claimed: number
  ran: number
  rescheduled: number
  failed: number
  cancelled: number
}

/** The cron's second half: the agent's due tasks, a few at a time. A thrown task is retried in 10 minutes, three tries in all. */
export async function runDueAgentTasks(now: Date = new Date(), limit = 10): Promise<DueRun> {
  const tasks = await runs.claimDueTasks(now, limit)
  const sum: DueRun = { claimed: tasks.length, ran: 0, rescheduled: 0, failed: 0, cancelled: 0 }
  for (const task of tasks) {
    try {
      const contact = await freshContact(task.contact_id)
      if (!contact) {
        await runs.finishTask(task.id, 'failed', { reason: 'no_contact' })
        sum.failed++
        continue
      }
      const run = await runs.getOpenRun(contact.id)
      if (contact.handoff_at || !run || run.status !== 'active' || (await stopped(contact))) {
        await runs.finishTask(task.id, 'cancelled', { reason: contact.handoff_at ? 'handoff' : !run || run.status !== 'active' ? 'no_active_run' : 'opted_out' })
        sum.cancelled++
        continue
      }
      if (task.kind === 'call') {
        const r = await dialAgentCall(contact, task, now)
        if ('callId' in r) {
          await runs.finishTask(task.id, 'done', { callId: r.callId })
          sum.ran++
        } else if ('reschedule' in r) {
          await runs.finishTask(task.id, 'pending', { reason: r.reason }, r.reschedule)
          sum.rescheduled++
        } else {
          await runs.finishTask(task.id, 'failed', { reason: r.fail })
          sum.failed++
        }
        continue
      }
      const language = (LANGUAGES as readonly string[]).includes(contact.language ?? '') ? (contact.language as OutreachLanguage) : 'en'
      const r = await runAgentTurn({ contact, channel: 'follow_up', trigger: await triggerFor(task), language, now })
      await runs.finishTask(task.id, 'done', { action: r.action, tools: r.tools })
      sum.ran++
    } catch (e) {
      log(`agent task ${task.id} failed`, e)
      if (task.attempts < 3) {
        await runs.finishTask(task.id, 'pending', { error: e instanceof Error ? e.message : String(e) }, new Date(now.getTime() + RETRY_MS)).catch(() => {})
        sum.rescheduled++
      } else {
        await runs.finishTask(task.id, 'failed', { error: e instanceof Error ? e.message : String(e) }).catch(() => {})
        sum.failed++
      }
    }
  }
  return sum
}

// ---- task-agent jobs ----

export interface JobsRun {
  claimed: number
  started: number
  deferred: number
  cancelled: number
  failed: number
}

/** Dial refusals that end the job as cancelled (the person or the program said no), not failed. */
const CANCEL_REASONS = new Set(['dnd', 'suppressed', 'program_disabled', 'not_test_number'])

/**
 * Takes a queued, due job for itself: active, unless another job (or an open run) holds the same phone. The phone's
 * advisory lock makes two due jobs for one number start one at a time. 'busy' leaves it queued.
 */
async function claimJob(id: string, now: Date): Promise<JobRow | 'busy' | null> {
  const client = await outreachPool().connect()
  try {
    await client.query('BEGIN')
    const cur = await client.query(
      `SELECT j.id, c.phone FROM outreach_jobs j JOIN outreach_contacts c ON c.id = j.contact_id WHERE j.id = $1 AND j.status = 'queued' AND j.due_at <= $2 FOR UPDATE OF j SKIP LOCKED`,
      [id, now]
    )
    const row = cur.rows[0] as { id: string; phone: string } | undefined
    if (!row) {
      await client.query('ROLLBACK')
      return null
    }
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [row.phone])
    if (await phoneBusy(row.phone, id, client)) {
      await client.query('ROLLBACK')
      return 'busy'
    }
    const up = await client.query(`UPDATE outreach_jobs SET status = 'active', updated_at = $2 WHERE id = $1 RETURNING *`, [id, now])
    await client.query('COMMIT')
    return toJob(up.rows[0])
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/** Jobs of people who opted out meanwhile are cancelled; a job nothing is working on for a day (no task, no call) fails. */
async function sweepJobs(now: Date, sum: JobsRun): Promise<void> {
  const pool = outreachPool()
  const stopped = await pool.query(
    `SELECT j.id FROM outreach_jobs j JOIN outreach_contacts c ON c.id = j.contact_id
      WHERE j.status IN ('queued', 'active', 'waiting')
        AND (c.opted_out_at IS NOT NULL OR c.status IN ('opted_out', 'suppressed') OR EXISTS (SELECT 1 FROM outreach_suppressions s WHERE s.phone = c.phone))
      LIMIT 50`
  )
  for (const r of stopped.rows as { id: string }[]) {
    await cancelJob(r.id, AGENT_ACTOR, 'opted_out', now)
    sum.cancelled++
  }
  const stale = await pool.query(
    `SELECT j.id FROM outreach_jobs j
      WHERE j.status IN ('active', 'waiting') AND j.updated_at < $1
        AND NOT EXISTS (SELECT 1 FROM outreach_agent_tasks t WHERE t.contact_id = j.contact_id AND t.status IN ('pending', 'running'))
        AND NOT EXISTS (SELECT 1 FROM outreach_calls oc WHERE oc.contact_id = j.contact_id AND oc.ended_at IS NULL)
      LIMIT 50`,
    [new Date(now.getTime() - 24 * 3600_000)]
  )
  for (const r of stale.rows as { id: string }[]) {
    await failJob(r.id, 'no_outcome', 'stale', now)
    sum.failed++
  }
}

/** Puts a claimed job back in the queue for later; its run (if one was made) ends so the phone is free. */
async function deferJob(job: JobRow, until: Date, now: Date, sum: JobsRun): Promise<void> {
  await outreachPool().query(`UPDATE outreach_agent_runs SET status = 'stopped', updated_at = $2, ended_at = $2 WHERE job_id = $1 AND status = 'active'`, [job.id, now])
  await setJobStatus(job.id, 'queued', { dueAt: until, now })
  sum.deferred++
}

/** The job's first touch: gates, then its run, then a call or a WhatsApp turn. */
async function startJob(job: JobRow, now: Date, sum: JobsRun): Promise<void> {
  const contact = await freshContact(job.contact_id)
  const skill = await loadJobSkill(job)
  if (!contact || !skill) {
    await failJob(job.id, 'error', contact ? 'agent_missing' : 'no_contact', now)
    sum.failed++
    return
  }
  const meta = skill.skill.meta
  const cancel = async (reason: string) => {
    await cancelJob(job.id, AGENT_ACTOR, reason, now)
    sum.cancelled++
  }
  if (await stopped(contact)) return cancel('opted_out')
  const state = await getProgramState(settingsProgram(contact)).catch(() => null)
  if (!state?.enabled) return deferJob(job, new Date(now.getTime() + 3600_000), now, sum)
  if (!inCallingWindow(now, state)) return deferJob(job, nextWindowTime(now, state), now, sum)
  const voiceFirst = meta.flow !== 'whatsapp_only' && meta.channels.includes('voice')
  if (meta.purpose === 'promotional') {
    if (contact.dnd_status === 'dnd') return cancel('dnd')
    // A promotional call needs a checked-clear DND status, like the Showcase dialler; test numbers are exempt.
    if (voiceFirst && contact.dnd_status !== 'clear' && !(state.test_numbers ?? []).includes(contact.phone)) return cancel('dnd_unchecked')
    if (meta.audience === 'shopper' && (await shopperConsent(contact.phone)).marketingOptOut) return cancel('marketing_opt_out')
  }

  const run = await runs.createRun({ contactId: contact.id, skillVersionId: skill.versionId, skillRef: skill.ref, jobId: job.id })
  if (run.job_id !== job.id) return deferJob(job, new Date(now.getTime() + JOB_DEFER_MS), now, sum)
  if (contact.kind === 'shopper' && contact.status !== 'interested') {
    await outreachPool().query(`UPDATE outreach_contacts SET status = 'interested', updated_at = now() WHERE id = $1 AND status NOT IN ('opted_out', 'suppressed')`, [contact.id])
    await recordEvent(contact.id, 'status_change', { actor: AGENT_ACTOR, data: { from: contact.status, to: 'interested', jobId: job.id } })
  }

  if (voiceFirst) {
    const r = await dialFor(contact, { kind: 'job', job }, now)
    if ('callId' in r) {
      await setJobStatus(job.id, 'active', { attempts: job.attempts + 1, now })
      sum.started++
    } else if ('reschedule' in r) await deferJob(job, r.reschedule, now, sum)
    else if (CANCEL_REASONS.has(r.fail)) await cancel(r.fail)
    else {
      await failJob(job.id, r.fail === 'call_limit' ? 'unreachable' : 'error', r.fail, now)
      sum.failed++
    }
    return
  }
  // WhatsApp first: only with the person's opt-in (the shopper's order-update choice, or consent recorded earlier).
  const consent = !!contact.consent_whatsapp_at || (meta.audience === 'shopper' && (await shopperConsent(contact.phone)).whatsappOptIn)
  if (!consent) return cancel('no_whatsapp_consent')
  if (!skill.skill.sections.follow_up) {
    await failJob(job.id, 'error', 'no_follow_up_section', now)
    sum.failed++
    return
  }
  await runs.scheduleTask({ runId: run.id, contactId: contact.id, kind: 'whatsapp_turn', dueAt: now, reason: 'kickoff', createdBy: AGENT_ACTOR })
  await setJobStatus(job.id, 'active', { attempts: job.attempts + 1, now })
  sum.started++
}

/**
 * The cron's job half (after the dialler, before the agent's own tasks): queued jobs that are due, a few at a time.
 * One live job per phone; outside the calling window or while the phone is busy a job stays queued.
 */
export async function runDueJobs(now: Date = new Date(), limit = 10): Promise<JobsRun> {
  const sum: JobsRun = { claimed: 0, started: 0, deferred: 0, cancelled: 0, failed: 0 }
  await sweepJobs(now, sum)
  const due = await outreachPool().query(
    `SELECT j.id FROM outreach_jobs j JOIN outreach_skills s ON s.id = j.skill_id
      WHERE j.status = 'queued' AND j.due_at <= $1 AND s.archived_at IS NULL AND (s.status = 'active' OR j.source = 'test')
      ORDER BY j.due_at LIMIT $2`,
    [now, limit]
  )
  for (const { id } of due.rows as { id: string }[]) {
    let job: JobRow | 'busy' | null = null
    try {
      job = await claimJob(id, now)
      if (job === 'busy') {
        await setJobStatus(id, 'queued', { dueAt: new Date(now.getTime() + JOB_DEFER_MS), now })
        sum.deferred++
      } else if (job) {
        sum.claimed++
        await startJob(job, now, sum)
      }
    } catch (e) {
      log(`job ${id} failed to start`, e)
      if (job && job !== 'busy') {
        await outreachPool().query(`UPDATE outreach_agent_runs SET status = 'stopped', updated_at = $2, ended_at = $2 WHERE job_id = $1 AND status = 'active'`, [id, now]).catch(() => {})
        await setJobStatus(id, 'queued', { dueAt: new Date(now.getTime() + RETRY_MS), now }).catch(() => {})
      }
      sum.deferred++
    }
  }
  return sum
}

// ---- first touch ----

/** What the dialler does with a due contact: ring it, start on WhatsApp (whatsapp_only skills, with consent), or skip it. */
export async function planFirstTouch(contact: OutreachContact, now: Date = new Date()): Promise<'call' | 'whatsapp' | 'skip'> {
  const { run, skill } = await ensureRun(contact, now)
  const { flow, channels } = skill.skill.meta
  if (flow !== 'whatsapp_only' && channels.includes('voice')) return 'call'
  try {
    if (!contact.consent_whatsapp_at) {
      await transition(contact, 'failed', { actor: AGENT_ACTOR, data: { reason: 'no_whatsapp_consent' } })
      return 'skip'
    }
    await transition(contact, 'interested', { actor: AGENT_ACTOR, data: { reason: 'whatsapp_first_touch' } })
  } catch (e) {
    if (e instanceof InvalidTransitionError) return 'skip'
    throw e
  }
  await runs.scheduleTask({ runId: run.id, contactId: contact.id, kind: 'whatsapp_turn', dueAt: now, reason: 'kickoff', createdBy: AGENT_ACTOR })
  return 'whatsapp'
}
