import { outreachPool, type Queryable } from '../db'
import { recordEvent } from '../events'
import { InvalidTransitionError, transition } from '../state'
import { isSuppressed } from '../suppress'
import type { OutreachContact } from '../types'
import * as runs from './runs'
import { coerceInputs } from './skill/inputs'
import { getAgent } from './skill/store'
import { resolveRefs } from './store/refs'
import { PROGRAM_OF, REF_TYPES, type AgentAudience, type AgentRunRow, type JobRow, type JobSource, type JobStatus } from './types'

// Jobs (docs/plans/OUTREACH_AGENTS.md §1): one task for one person. This file creates them, lists them and moves them
// through their life; the scheduler that starts them is runtime.ts runDueJobs. Plain SQL over outreach_jobs.

export class JobError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
    this.name = 'JobError'
  }
}

const TERMINAL: readonly JobStatus[] = ['completed', 'failed', 'cancelled']
/** A job in one of these holds its phone: no other job for that number starts. */
export const LIVE_JOB_STATUSES: readonly JobStatus[] = ['active', 'waiting']
const FINISHABLE = `('queued', 'active', 'waiting', 'handed_off')`
const PAGE_SIZE = 50

/** The registered outreach program: its window, caps, enabled switch and test numbers govern every agent. */
export const SHOWCASE_PROGRAM = 'showcase-offer'

/** The contact program a job's person belongs to. Shopper contacts are their own program; leads stay in the registered Showcase program. */
export const contactProgram = (audience: AgentAudience): string => (audience === 'shopper' ? PROGRAM_OF.shopper : SHOWCASE_PROGRAM)

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v))

export function toJob(r: any): JobRow {
  return { ...r, due_at: iso(r.due_at), created_at: iso(r.created_at), updated_at: iso(r.updated_at), ended_at: isoOrNull(r.ended_at), inputs: r.inputs ?? {}, refs: r.refs ?? {} }
}

export async function getJobById(id: string): Promise<JobRow | null> {
  const r = await outreachPool().query(`SELECT * FROM outreach_jobs WHERE id = $1`, [id])
  return r.rows[0] ? toJob(r.rows[0]) : null
}

// ---- creation ----

export interface CreateJobInput {
  skillId: string
  inputs: Record<string, unknown>
  source: JobSource
  /** Defaults to the value of the input named by meta.trigger.dedupe; none for a test job. */
  sourceRef?: string | null
  dueAt?: Date
  actor: { id: string | null; label: string }
}

export interface CreateJobResult {
  job: JobRow | null
  created: boolean
  errors: string[]
}

const refresh = (errors: string[]): CreateJobResult => ({ job: null, created: false, errors })

/** Upserts the person on (program, phone); a shopper has no business name. */
async function upsertContact(program: string, audience: AgentAudience, phone: string, name: string | null, language: string | null): Promise<OutreachContact> {
  const r = await outreachPool().query(
    `INSERT INTO outreach_contacts (program, phone, business_name, kind, owner_name, language, source, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'agent_job', 'queued')
     ON CONFLICT (program, phone) DO UPDATE SET
       owner_name = COALESCE(EXCLUDED.owner_name, outreach_contacts.owner_name),
       language = COALESCE(EXCLUDED.language, outreach_contacts.language),
       updated_at = now()
     RETURNING *`,
    [program, phone, audience === 'lead' ? name ?? phone : null, audience, name, language]
  )
  return r.rows[0]
}

/**
 * A validated job for an agent: inputs coerced against its current version, the contact upserted, references resolved
 * (one that does not resolve is an error: no job), deduped on (skill_id, source_ref). An agent that is not active only
 * takes test jobs.
 */
export async function createJob(input: CreateJobInput): Promise<CreateJobResult> {
  const agent = await getAgent(input.skillId)
  if (!agent) return refresh(['Agent not found'])
  if (agent.archived) return refresh(['This agent is archived'])
  if (agent.status !== 'active' && input.source !== 'test') return refresh([`This agent is ${agent.status}; activate it before adding jobs`])
  const { resolved } = agent
  const { meta } = resolved.skill

  const { inputs, errors } = coerceInputs(meta.inputs, input.inputs ?? {})
  const entries = Object.entries(meta.inputs)
  const phoneKey = entries.find(([, s]) => s.role === 'contact')?.[0]
  if (!phoneKey) return refresh(['This agent has no input with role: contact, so a job has nobody to reach'])
  if (errors.length) return refresh(errors)
  const phone = inputs[phoneKey] as string | undefined
  if (!phone) return refresh([`${phoneKey} is required`])
  const key = (role: 'name' | 'language') => entries.find(([, s]) => s.role === role)?.[0]
  const name = (key('name') ? (inputs[key('name')!] as string | undefined) : undefined) ?? null
  const language = (key('language') ? (inputs[key('language')!] as string | undefined) : undefined) ?? null

  if (await isSuppressed(phone)) return refresh(['This number is on the suppression list'])
  let refs = {}
  if (entries.some(([, s]) => REF_TYPES.includes(s.type))) {
    const r = await resolveRefs(inputs, meta.inputs, phone)
    if (r.errors.length) return refresh(r.errors)
    refs = r.refs
  }

  const contact = await upsertContact(contactProgram(meta.audience), meta.audience, phone, name, language)
  if (contact.opted_out_at || contact.status === 'opted_out' || contact.status === 'suppressed') return refresh(['This person has opted out'])

  const dedupeValue = meta.trigger.dedupe ? inputs[meta.trigger.dedupe] : undefined
  const sourceRef = input.sourceRef !== undefined ? input.sourceRef : input.source === 'test' || dedupeValue == null ? null : String(dedupeValue)
  const pool = outreachPool()
  const ins = await pool.query(
    `INSERT INTO outreach_jobs (skill_id, skill_version_id, contact_id, inputs, refs, source, source_ref, due_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, now()), $9)
     ON CONFLICT (skill_id, source_ref) WHERE source_ref IS NOT NULL DO NOTHING
     RETURNING *`,
    [input.skillId, resolved.versionId, contact.id, JSON.stringify(inputs), JSON.stringify(refs), input.source, sourceRef, input.dueAt ?? null, input.actor.id ?? input.actor.label]
  )
  if (ins.rows[0]) {
    const job = toJob(ins.rows[0])
    await recordEvent(contact.id, 'job_created', { actor: input.actor.label, data: { jobId: job.id, skillId: job.skill_id, source: job.source, sourceRef } })
    return { job, created: true, errors: [] }
  }
  const existing = await pool.query(`SELECT * FROM outreach_jobs WHERE skill_id = $1 AND source_ref = $2`, [input.skillId, sourceRef])
  return { job: existing.rows[0] ? toJob(existing.rows[0]) : null, created: false, errors: [] }
}

// ---- reading ----

export interface JobListRow {
  id: string
  status: JobStatus
  outcome: string | null
  source: string
  source_ref: string | null
  due_at: string
  created_at: string
  ended_at: string | null
  contact: { id: string; name: string | null; phone_last4: string }
  inputs: Record<string, unknown>
}

/** The agent's jobs, newest first; the inputs' phone numbers are masked to the last four digits. */
export async function listJobs(skillId: string, f: { status?: string; outcome?: string; page?: number } = {}): Promise<{ rows: JobListRow[]; total: number; page: number; pageSize: number }> {
  const where = ['j.skill_id = $1']
  const params: unknown[] = [skillId]
  if (f.status) {
    params.push(f.status)
    where.push(`j.status = $${params.length}`)
  }
  if (f.outcome) {
    params.push(f.outcome)
    where.push(`j.outcome = $${params.length}`)
  }
  const page = Math.max(f.page ?? 1, 1)
  const w = where.join(' AND ')
  const pool = outreachPool()
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT j.*, c.owner_name, c.business_name, c.phone FROM outreach_jobs j JOIN outreach_contacts c ON c.id = j.contact_id
        WHERE ${w} ORDER BY j.created_at DESC, j.id LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
      params
    ),
    pool.query(`SELECT count(*)::int AS n FROM outreach_jobs j WHERE ${w}`, params),
  ])
  return {
    rows: rows.rows.map((r: any) => ({
      id: r.id,
      status: r.status,
      outcome: r.outcome ?? null,
      source: r.source,
      source_ref: r.source_ref ?? null,
      due_at: iso(r.due_at),
      created_at: iso(r.created_at),
      ended_at: isoOrNull(r.ended_at),
      contact: { id: r.contact_id, name: r.owner_name ?? r.business_name ?? null, phone_last4: String(r.phone ?? '').replace(/\D/g, '').slice(-4) },
      inputs: maskInputs(r.inputs ?? {}),
    })),
    total: count.rows[0]?.n ?? 0,
    page,
    pageSize: PAGE_SIZE,
  }
}

const PHONE_LIKE = /^\+?\d{10,14}$/

function maskInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, typeof v === 'string' && PHONE_LIKE.test(v) ? `••••${v.slice(-4)}` : v]))
}

export interface JobDetail {
  job: JobRow
  contact: Pick<OutreachContact, 'id' | 'program' | 'phone' | 'owner_name' | 'business_name' | 'language' | 'status' | 'consent_whatsapp_at' | 'opted_out_at' | 'dnd_status' | 'handoff_at' | 'handoff_reason'> & { kind: string }
  run: AgentRunRow | null
  calls: Record<string, unknown>[]
  messages: Record<string, unknown>[]
  toolCalls: Record<string, unknown>[]
}

/** The job with its contact, latest run, the calls and messages since the job began, and the run's tool calls. */
export async function getJobDetail(id: string): Promise<JobDetail | null> {
  const job = await getJobById(id)
  if (!job) return null
  const pool = outreachPool()
  const [c, run, runIds] = await Promise.all([
    pool.query(
      `SELECT id, program, kind, phone, owner_name, business_name, language, status, consent_whatsapp_at, opted_out_at, dnd_status, handoff_at, handoff_reason FROM outreach_contacts WHERE id = $1`,
      [job.contact_id]
    ),
    runs.getJobRun(id),
    pool.query(`SELECT id, started_at FROM outreach_agent_runs WHERE job_id = $1 ORDER BY started_at`, [id]),
  ])
  if (!c.rows[0]) return null
  const ids = (runIds.rows as { id: string; started_at: Date }[]).map(r => r.id)
  const since = runIds.rows[0]?.started_at ?? job.created_at
  const until = job.ended_at ?? new Date()
  const [calls, messages, events] = await Promise.all([
    pool.query(
      `SELECT id, status, outcome, language, started_at, answered_at, ended_at, duration_s, summary, (recording_key IS NOT NULL) AS has_recording, created_at
         FROM outreach_calls WHERE contact_id = $1 AND created_at >= $2 AND created_at <= $3 ORDER BY created_at`,
      [job.contact_id, since, until]
    ),
    pool.query(
      `SELECT id, direction, template_slug, body, status, created_at FROM outreach_messages WHERE contact_id = $1 AND created_at >= $2 AND created_at <= $3 ORDER BY created_at`,
      [job.contact_id, since, until]
    ),
    ids.length
      ? pool.query(`SELECT id, call_id, data, actor, created_at FROM outreach_events WHERE contact_id = $1 AND kind = 'tool_call' AND data->>'runId' = ANY($2) ORDER BY id`, [job.contact_id, ids])
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
  ])
  return { job, contact: c.rows[0], run, calls: calls.rows, messages: messages.rows, toolCalls: events.rows }
}

// ---- lifecycle ----

/** True when another job for this phone is live, or a run for it is open for a different job. */
export async function phoneBusy(phone: string, exceptJobId: string, db: Queryable = outreachPool()): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM outreach_jobs j JOIN outreach_contacts c ON c.id = j.contact_id WHERE c.phone = $1 AND j.id <> $2 AND j.status = ANY($3)
     UNION ALL
     SELECT 1 FROM outreach_agent_runs r JOIN outreach_contacts c ON c.id = r.contact_id WHERE c.phone = $1 AND r.status IN ('active', 'handed_off') AND r.job_id IS DISTINCT FROM $2
     LIMIT 1`,
    [phone, exceptJobId, LIVE_JOB_STATUSES]
  )
  return r.rows.length > 0
}

/** Ends the job's open run, drops the contact's pending tasks and frees a shopper contact for the next job. */
async function endJobRun(job: JobRow, runStatus: 'completed' | 'stopped', reason: string, now: Date): Promise<void> {
  const pool = outreachPool()
  await pool.query(`UPDATE outreach_agent_runs SET status = $2, updated_at = $3, ended_at = $3 WHERE job_id = $1 AND status IN ('active', 'handed_off')`, [job.id, runStatus, now])
  await runs.cancelTasks(job.contact_id, reason)
  const c = await pool.query(`SELECT kind, status FROM outreach_contacts WHERE id = $1`, [job.contact_id])
  if (c.rows[0]?.kind === 'shopper' && ['interested', 'calling'].includes(c.rows[0].status)) {
    await transition({ id: job.contact_id }, 'queued', { actor: 'outreach:jobs', data: { reason: 'job_ended', jobId: job.id } }).catch(e => {
      if (!(e instanceof InvalidTransitionError)) throw e
    })
  }
}

/** Moves an open job to a terminal status. Null when it was already finished. */
async function finish(id: string, status: 'completed' | 'failed' | 'cancelled', outcome: string | null, result: Record<string, unknown> | null, actor: string, now: Date): Promise<JobRow | null> {
  const r = await outreachPool().query(
    `UPDATE outreach_jobs SET status = $2, outcome = COALESCE($3, outcome), result = COALESCE($4::jsonb, result), updated_at = $5, ended_at = $5
      WHERE id = $1 AND status IN ${FINISHABLE} RETURNING *`,
    [id, status, outcome, result ? JSON.stringify(result) : null, now]
  )
  if (!r.rows[0]) return null
  const job = toJob(r.rows[0])
  await endJobRun(job, status === 'completed' ? 'completed' : 'stopped', `job_${status}`, now)
  await recordEvent(job.contact_id, `job_${status}`, { actor, data: { jobId: job.id, outcome, ...(result ?? {}) } })
  return job
}

/** The agent (or an admin) recorded how the job ended: completes the job and its run. */
export const completeJob = (id: string, outcome: string, opts: { note?: string | null; actor?: string; now?: Date } = {}): Promise<JobRow | null> =>
  finish(id, 'completed', outcome, opts.note ? { note: opts.note } : null, opts.actor ?? 'outreach:agent', opts.now ?? new Date())

/** The system gave up (unreachable, no consent, stale): the job fails with an outcome and a reason. */
export const failJob = (id: string, outcome: string, reason: string, now: Date = new Date()): Promise<JobRow | null> =>
  finish(id, 'failed', outcome, { reason }, 'outreach:scheduler', now)

export async function cancelJob(id: string, actor: string, reason = 'cancelled', now: Date = new Date()): Promise<JobRow | null> {
  const job = await finish(id, 'cancelled', null, { reason }, actor, now)
  if (!job && !(await getJobById(id))) throw new JobError('Job not found', 404)
  return job
}

/** A failed or cancelled job goes back in the queue, due now, with its attempts reset. */
export async function retryJob(id: string, actor: string, now: Date = new Date()): Promise<JobRow> {
  const cur = await getJobById(id)
  if (!cur) throw new JobError('Job not found', 404)
  if (cur.status !== 'failed' && cur.status !== 'cancelled') throw new JobError(`A ${cur.status} job cannot be retried`, 409)
  const c = await outreachPool().query(`SELECT phone, status, opted_out_at FROM outreach_contacts WHERE id = $1`, [cur.contact_id])
  const contact = c.rows[0]
  if (!contact || contact.opted_out_at || contact.status === 'opted_out' || contact.status === 'suppressed' || (await isSuppressed(contact.phone))) throw new JobError('This person has opted out', 409)
  const r = await outreachPool().query(
    `UPDATE outreach_jobs SET status = 'queued', due_at = $2, attempts = 0, outcome = NULL, result = NULL, ended_at = NULL, updated_at = $2 WHERE id = $1 AND status IN ('failed', 'cancelled') RETURNING *`,
    [id, now]
  )
  if (!r.rows[0]) throw new JobError('The job changed; reload and try again', 409)
  await recordEvent(cur.contact_id, 'job_retried', { actor, data: { jobId: id } })
  return toJob(r.rows[0])
}

/** A non-terminal status change (queued, active, waiting, handed_off); ended jobs stay ended. */
export async function setJobStatus(id: string, status: 'queued' | 'active' | 'waiting' | 'handed_off', opts: { dueAt?: Date; attempts?: number; now?: Date } = {}): Promise<JobRow | null> {
  const r = await outreachPool().query(
    `UPDATE outreach_jobs SET status = $2, due_at = COALESCE($3, due_at), attempts = COALESCE($4, attempts), updated_at = $5 WHERE id = $1 AND status IN ${FINISHABLE} RETURNING *`,
    [id, status, opts.dueAt ?? null, opts.attempts ?? null, opts.now ?? new Date()]
  )
  return r.rows[0] ? toJob(r.rows[0]) : null
}

/** The job a run serves, or null (a Showcase lead run, or no run). */
export async function jobOfRun(run: Pick<AgentRunRow, 'job_id'> | null): Promise<JobRow | null> {
  return run?.job_id ? getJobById(run.job_id) : null
}

/** The job the contact is in the middle of (active or waiting), if any. */
export async function liveJobOf(contactId: string): Promise<JobRow | null> {
  const r = await outreachPool().query(`SELECT * FROM outreach_jobs WHERE contact_id = $1 AND status = ANY($2) ORDER BY updated_at DESC LIMIT 1`, [contactId, LIVE_JOB_STATUSES])
  return r.rows[0] ? toJob(r.rows[0]) : null
}

export const isTerminalJob = (j: Pick<JobRow, 'status'>) => TERMINAL.includes(j.status)
