import { controlPlanePool } from '@/lib/tenant-registry'
import { stoppedSql } from '@/lib/tenant-registry/provisioning'
import { mailShell } from '@/lib/shared/mail-template'
import { STEP_CATALOG, indexOfStep, pipelineOf, type StepId, type StoredPipeline } from './pipeline'

/**
 * Provisioning alerts go through the audited mail service like everything else.
 *
 * These used to build their own transporter call, so they never appeared in
 * /admin/audit?tab=mail_log — the one place to check what the platform has sent — and were
 * plain text, unreadable next to every other mail the system produces.
 */
async function send(subject: string, body: string): Promise<void> {
  await sendPlatformAlert(subject, body)
}

/** Mail the platform admin through the audited mail service (shared by other platform monitors). */
export async function sendPlatformAlert(
  subject: string,
  body: string,
  opts: { kind?: string; kicker?: string; footer?: string } = {}
): Promise<void> {
  const { platformAdminEmail, adminMailFrom, platformBrandName } = await import('@/lib/catalog/brand')
  const to = platformAdminEmail()
  if (!to) return
  try {
    const { sendAuditedMail } = await import('@/lib/shared/mail-audit')
    await sendAuditedMail({
      to,
      from: adminMailFrom(),
      subject,
      text: body,
      html: alertHtml(subject, body, platformBrandName(), opts.kicker, opts.footer),
      kind: opts.kind ?? 'provisioning_alert',
    })
  } catch (e: any) {
    console.error('[provisioning-alert] send failed:', e?.message || e)
  }
}

/** Operational alert: monospaced body so step names, ids and errors stay readable. */
function alertHtml(
  subject: string,
  body: string,
  brand: string,
  kicker = 'Provisioning Alert',
  footer = 'Automated provisioning alert.'
): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return mailShell({
    brand,
    kicker,
    title: subject,
    content: `<div class="danger"><pre class="alert-body mono">${esc(body)}</pre></div>`,
    footerLines: [footer],
    extraCss: `
  .alert-body { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.55; }
`,
  })
}

// Absolute link to the platform admin's Ecom customers page (alerts are plain-text mail, where a
// bare path is not clickable). The admin host serves pages at the root.
async function ecomAdminUrl(): Promise<string> {
  const { currentAdminBaseUrlAsync } = await import('@/lib/catalog/brand')
  return `${await currentAdminBaseUrlAsync()}/ecom/customers`
}

/**
 * A one-off failure outside the build's own step machine (post-live hooks, plan changes, cleanup). A build job that
 * fails or sticks is mailed by sweepProvisioningIncidents instead.
 */
export async function alertProvisioningFailure(
  tenantSlug: string,
  step: string,
  error: string,
  tenantId?: string
): Promise<void> {
  const where = `${await ecomAdminUrl()}${tenantId ? `/${tenantId}?tab=provisioning` : ''}`
  // owner_admin_cert and mtls_fleet_refresh run AFTER the job is already `done` — the store is
  // live and nothing is rolled back; they get a re-run instruction.
  const nonFatal = step === 'owner_admin_cert' || step === 'mtls_fleet_refresh'
  const tail = nonFatal
    ? `The store is live; this post-provisioning step failed and can be safely re-run. Inspect at ${where}`
    : `Inspect at ${where}`
  await send(
    `[Jeffi] Provisioning ${nonFatal ? 'step failed (store live)' : 'FAILED'}: ${tenantSlug}`,
    `Tenant : ${tenantSlug}\nStep   : ${step}\nError  : ${error}\n\n${tail}`
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Build incidents: a tenant's latest job that failed, or sits on one step past its timeout plus a margin. One mail
// when it opens, one when it recovers, none while it lasts. The state is a pair of provisioning_step_events rows on
// the job (alert_incident / alert_recovered); the tenant's latest such row says whether one is open.
// ---------------------------------------------------------------------------------------------------------------

const MIN = 60_000
/** Slack past a step's timeout before it counts as stuck (the runner's own retries usually end it sooner). */
export const STUCK_MARGIN_MS = 15 * MIN
/** Steps without a catalog timeout bound their own wait; the longest (the node database) is 30 min. */
export const DEFAULT_STEP_BOUND_MS = 30 * MIN
/** A failure this old with no incident open predates the sweep (the old hourly digest mailed it): not mailed. */
export const FAILED_LOOKBACK_MS = 7 * 24 * 60 * MIN

export const INCIDENT_STEP = 'alert_incident'
export const RECOVERED_STEP = 'alert_recovered'
const SWEEP_LOCK_KEY = 0x70616c72 // arbitrary, app-wide

export const stuckAfterMs = (step: string): number =>
  (STEP_CATALOG[step as StepId]?.timeoutMs ?? DEFAULT_STEP_BOUND_MS) + STUCK_MARGIN_MS

export type IncidentKind = 'failed' | 'stuck'

/** A tenant's latest job as the sweep reads it. */
export interface JobState {
  jobId: string
  tenantId: string
  slug: string
  tenantStatus: string
  status: string
  step: string
  lastError: string | null
  pipeline: StoredPipeline | null
  rolledBack: boolean
  stopped: boolean
  /** Since step_started_at (else updated_at). */
  stepAgeMs: number
  updatedAgeMs: number
}

export interface OpenIncident {
  tenantId: string
  jobId: string
  step: string
  kind: IncidentKind
  since: string
}

export type IncidentAction =
  | { action: 'none' }
  | { action: 'ongoing' }
  | { action: 'open'; kind: IncidentKind; escalated?: boolean }
  | { action: 'recover' }
  | { action: 'close'; reason: string }

// The job is past the incident's step: finished, or on a later step of its pipeline.
function movedPast(job: JobState, open: OpenIncident): boolean {
  if (job.status === 'done') return true
  const p = pipelineOf(job.pipeline)
  const was = indexOfStep(p, open.step)
  return was >= 0 && indexOfStep(p, job.step) > was
}

/** Pure: what the sweep does about one tenant, given its latest job and open incident. */
export function decideIncident(job: JobState | null, open: OpenIncident | null): IncidentAction {
  // Stopped by a person, or deprovisioned: never alert; an open incident closes without mail.
  if (!job || job.stopped || job.tenantStatus === 'terminated') {
    if (!open) return { action: 'none' }
    return { action: 'close', reason: !job ? 'job gone' : job.stopped ? 'build stopped' : 'store deprovisioned' }
  }
  const active = job.status === 'pending' || job.status === 'running'
  const kind: IncidentKind | null =
    job.status === 'failed' ? 'failed' : active && job.stepAgeMs > stuckAfterMs(job.step) ? 'stuck' : null
  if (!open) {
    if (!kind || (kind === 'failed' && job.updatedAgeMs > FAILED_LOOKBACK_MS)) return { action: 'none' }
    return { action: 'open', kind }
  }
  const progressed = movedPast(job, open)
  // Resumed but still on the incident's step: not recovered until it moves on.
  if (!kind) return progressed ? { action: 'recover' } : { action: 'ongoing' }
  // A fresh run, or this run past the incident's step, in trouble again: a new incident.
  if (job.jobId !== open.jobId || progressed) return { action: 'open', kind }
  // Stuck, then failed on that step (rollback may have run): one escalation.
  if (open.kind === 'stuck' && kind === 'failed') return { action: 'open', kind, escalated: true }
  return { action: 'ongoing' }
}

const fmtMin = (ms: number) => `${Math.max(0, Math.round(ms / MIN))} min`

function incidentMail(job: JobState, kind: IncidentKind, link: string, escalatedFrom?: OpenIncident): [string, string] {
  const tail = `\n\nInspect at ${link}\n\nYou will get one recovery notice; no repeats while this lasts.`
  if (kind === 'stuck') {
    const timeout = STEP_CATALOG[job.step as StepId]?.timeoutMs
    return [
      `[Jeffi] Provisioning stuck: ${job.slug} at ${job.step}`,
      `Tenant : ${job.slug}\nStep   : ${job.step} (${job.status})\nOn step: ${fmtMin(job.stepAgeMs)} ` +
        `(limit ${fmtMin(stuckAfterMs(job.step))}: ${timeout ? 'step timeout' : 'default bound'} + ${fmtMin(STUCK_MARGIN_MS)} margin)\n` +
        `Error  : ${job.lastError ?? '(none)'}${tail}`,
    ]
  }
  const rollback = job.rolledBack
    ? 'Rollback has run: start a fresh provision.'
    : 'Not rolled back: it can be resumed from the admin page.'
  const was = escalatedFrom ? `\nReported stuck on this step since ${escalatedFrom.since}.` : ''
  return [
    `[Jeffi] Provisioning FAILED: ${job.slug}`,
    `Tenant : ${job.slug}\nStep   : ${job.step}\nError  : ${job.lastError ?? '(none)'}\n\n${rollback}${was}${tail}`,
  ]
}

function recoveryMail(job: JobState, open: OpenIncident, link: string): [string, string] {
  const now = job.status === 'done' ? 'done' : `at ${job.step} (${job.status})`
  return [
    `[Jeffi] Provisioning recovered: ${job.slug}`,
    `Tenant : ${job.slug}\nWas    : ${open.kind} at ${open.step} since ${open.since} (~${fmtMin(Date.now() - Date.parse(open.since))})\n` +
      `Now    : ${job.jobId === open.jobId ? '' : 'a new run is '}${now}\n\nInspect at ${link}`,
  ]
}

async function openIncidents(): Promise<Map<string, OpenIncident>> {
  const res = await controlPlanePool().query(
    `SELECT tenant_id, job_id, detail, created_at FROM (
       SELECT DISTINCT ON (tenant_id) tenant_id, job_id, step, detail, created_at
         FROM provisioning_step_events
        WHERE step IN ($1, $2)
        ORDER BY tenant_id, created_at DESC
     ) a WHERE step = $1`,
    [INCIDENT_STEP, RECOVERED_STEP]
  )
  const out = new Map<string, OpenIncident>()
  for (const r of res.rows as any[]) {
    const d = r.detail ?? {}
    out.set(r.tenant_id, {
      tenantId: r.tenant_id,
      jobId: r.job_id,
      step: String(d.step ?? ''),
      kind: d.kind === 'stuck' ? 'stuck' : 'failed',
      since: d.since ?? new Date(r.created_at).toISOString(),
    })
  }
  return out
}

// Each tenant's latest job: the unfinished or failed ones, and any with an incident open.
async function latestJobs(withIncident: string[]): Promise<Map<string, JobState>> {
  const res = await controlPlanePool().query(
    `WITH latest AS (SELECT DISTINCT ON (tenant_id) * FROM provisioning_jobs ORDER BY tenant_id, created_at DESC)
     SELECT j.id, j.tenant_id, t.slug, t.status AS tenant_status, j.status, j.step, j.last_error, j.pipeline,
            COALESCE(j.created_resources->>'rolledBack', '') = 'true' AS rolled_back,
            ${stoppedSql('j')} AS stopped,
            EXTRACT(EPOCH FROM (now() - COALESCE(j.step_started_at, j.updated_at))) * 1000 AS step_age_ms,
            EXTRACT(EPOCH FROM (now() - j.updated_at)) * 1000 AS updated_age_ms
       FROM latest j JOIN tenants t ON t.id = j.tenant_id
      WHERE j.status IN ('pending', 'running', 'failed') OR j.tenant_id = ANY($1::uuid[])`,
    [withIncident]
  )
  const out = new Map<string, JobState>()
  for (const r of res.rows as any[]) {
    out.set(r.tenant_id, {
      jobId: r.id,
      tenantId: r.tenant_id,
      slug: r.slug,
      tenantStatus: r.tenant_status,
      status: r.status,
      step: r.step,
      lastError: r.last_error ?? null,
      pipeline: r.pipeline ?? null,
      rolledBack: r.rolled_back === true,
      stopped: r.stopped === true,
      stepAgeMs: Number(r.step_age_ms) || 0,
      updatedAgeMs: Number(r.updated_age_ms) || 0,
    })
  }
  return out
}

async function recordAlert(
  jobId: string,
  tenantId: string,
  step: typeof INCIDENT_STEP | typeof RECOVERED_STEP,
  message: string,
  detail: Record<string, unknown>
): Promise<void> {
  await controlPlanePool().query(
    `INSERT INTO provisioning_step_events (job_id, tenant_id, step, status, message, detail) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [jobId, tenantId, step, step === INCIDENT_STEP ? 'warning' : 'ok', message, JSON.stringify(detail)]
  )
}

export type AlertSender = (subject: string, body: string) => Promise<void>

export interface IncidentSweepResult {
  opened: number
  recovered: number
  closed: number
  skipped?: string
}

/**
 * Open, escalate and close build incidents, mailing only on those transitions. Run by the worker every tick and by
 * the hourly reconcile as a backstop; an advisory lock keeps two sweeps from mailing the same incident. The state is
 * written before the mail, so a failed send is never retried into a storm.
 */
export async function sweepProvisioningIncidents(sendAlert: AlertSender = send): Promise<IncidentSweepResult> {
  const out: IncidentSweepResult = { opened: 0, recovered: 0, closed: 0 }
  const lock = await controlPlanePool().connect()
  try {
    const got = await lock.query('SELECT pg_try_advisory_lock($1) AS ok', [SWEEP_LOCK_KEY])
    if (!got.rows[0]?.ok) return { ...out, skipped: 'another sweep is running' }
    try {
      const open = await openIncidents()
      const jobs = await latestJobs([...open.keys()])
      const base = await ecomAdminUrl()
      for (const tenantId of new Set([...open.keys(), ...jobs.keys()])) {
        const job = jobs.get(tenantId) ?? null
        const inc = open.get(tenantId) ?? null
        const d = decideIncident(job, inc)
        try {
          if (d.action === 'open' && job) {
            const since = d.escalated && inc ? inc.since : new Date().toISOString()
            await recordAlert(job.jobId, tenantId, INCIDENT_STEP, `${d.kind} alert sent (${job.step})`, {
              kind: d.kind,
              step: job.step,
              since,
              ...(d.escalated ? { escalated: true } : {}),
            })
            out.opened++
            await sendAlert(...incidentMail(job, d.kind, `${base}/${tenantId}?tab=provisioning`, d.escalated ? (inc ?? undefined) : undefined))
          } else if (d.action === 'recover' && job && inc) {
            await recordAlert(inc.jobId, tenantId, RECOVERED_STEP, `recovery alert sent (${job.status === 'done' ? 'done' : job.step})`, {
              jobId: job.jobId,
              step: job.step,
              status: job.status,
            })
            out.recovered++
            await sendAlert(...recoveryMail(job, inc, `${base}/${tenantId}?tab=provisioning`))
          } else if (d.action === 'close' && inc) {
            await recordAlert(inc.jobId, tenantId, RECOVERED_STEP, `closed without alert: ${d.reason}`, { reason: d.reason })
            out.closed++
          }
        } catch (e: any) {
          console.error(`[provisioning-alert] incident ${tenantId} failed:`, e?.message || e)
        }
      }
    } finally {
      await lock.query('SELECT pg_advisory_unlock($1)', [SWEEP_LOCK_KEY]).catch(() => {})
    }
  } finally {
    lock.release()
  }
  return out
}
