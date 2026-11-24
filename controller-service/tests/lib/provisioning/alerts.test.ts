import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory provisioning_step_events + the rows the sweep's latest-job query returns.
const db = vi.hoisted(() => {
  const state = { events: [] as any[], jobs: [] as any[], lockFree: true }
  const pool = {
    query: async (sql: string, params: any[] = []) => {
      if (sql.includes('WITH latest')) {
        const withIncident = new Set(params[0])
        return { rows: state.jobs.filter(j => ['pending', 'running', 'failed'].includes(j.status) || withIncident.has(j.tenant_id)) }
      }
      if (sql.includes('FROM provisioning_step_events') && sql.includes('DISTINCT ON')) {
        const latest = new Map<string, any>()
        for (const e of state.events) if (e.step === params[0] || e.step === params[1]) latest.set(e.tenant_id, e)
        return { rows: [...latest.values()].filter(e => e.step === params[0]) }
      }
      if (sql.startsWith('INSERT INTO provisioning_step_events')) {
        const [job_id, tenant_id, step, status, message, detail] = params
        state.events.push({ job_id, tenant_id, step, status, message, detail: JSON.parse(detail), created_at: new Date() })
        return { rowCount: 1, rows: [] }
      }
      throw new Error(`unexpected SQL: ${sql}`)
    },
    connect: async () => ({
      query: async (sql: string) => (sql.includes('pg_try_advisory_lock') ? { rows: [{ ok: state.lockFree }] } : { rows: [] }),
      release: () => {},
    }),
  }
  return { state, pool }
})
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => db.pool }))
vi.mock('@/lib/catalog/brand', () => ({ currentAdminBaseUrlAsync: async () => 'https://admin.test' }))

import {
  decideIncident,
  sweepProvisioningIncidents,
  stuckAfterMs,
  FAILED_LOOKBACK_MS,
  INCIDENT_STEP,
  RECOVERED_STEP,
  type JobState,
  type OpenIncident,
} from '@controller/lib/provisioning/alerts'
import { buildPipeline } from '@controller/lib/provisioning/pipeline'

const MIN = 60_000
const PIPE = buildPipeline({ db: { mode: 'node' } }, 'basic', { engine: 'k8s', provider: 'aws', restore: false, seed: false })
const LINK = 'https://admin.test/ecom/customers/t-1?tab=provisioning'

const job = (over: Partial<JobState> = {}): JobState => ({
  jobId: 'job-1',
  tenantId: 't-1',
  slug: 'acme',
  tenantStatus: 'provisioning',
  status: 'failed',
  step: 'launch_server',
  lastError: 'boom',
  pipeline: PIPE,
  rolledBack: false,
  stopped: false,
  stepAgeMs: MIN,
  updatedAgeMs: MIN,
  ...over,
})
const open = (over: Partial<OpenIncident> = {}): OpenIncident => ({
  tenantId: 't-1',
  jobId: 'job-1',
  step: 'launch_server',
  kind: 'failed',
  since: new Date(Date.now() - 10 * MIN).toISOString(),
  ...over,
})

describe('decideIncident', () => {
  it('opens on a failed build, and on one past its step timeout plus the margin', () => {
    expect(decideIncident(job(), null)).toEqual({ action: 'open', kind: 'failed' })
    expect(stuckAfterMs('launch_server')).toBe(30 * MIN)
    expect(decideIncident(job({ status: 'pending', stepAgeMs: 29 * MIN }), null)).toEqual({ action: 'none' })
    expect(decideIncident(job({ status: 'running', stepAgeMs: 31 * MIN }), null)).toEqual({ action: 'open', kind: 'stuck' })
  })

  it('a step without a timeout gets the default bound', () => {
    expect(stuckAfterMs('load_schema')).toBe(45 * MIN)
    expect(decideIncident(job({ status: 'pending', step: 'load_schema', stepAgeMs: 40 * MIN }), null)).toEqual({ action: 'none' })
    expect(decideIncident(job({ status: 'pending', step: 'load_schema', stepAgeMs: 46 * MIN }), null)).toEqual({ action: 'open', kind: 'stuck' })
  })

  it('never alerts a stopped build or a deprovisioned store; an open incident closes silently', () => {
    expect(decideIncident(job({ stopped: true }), null)).toEqual({ action: 'none' })
    expect(decideIncident(job({ status: 'pending', stepAgeMs: 99 * MIN, tenantStatus: 'terminated' }), null)).toEqual({ action: 'none' })
    expect(decideIncident(job({ stopped: true }), open())).toEqual({ action: 'close', reason: 'build stopped' })
    expect(decideIncident(job({ tenantStatus: 'terminated' }), open())).toEqual({ action: 'close', reason: 'store deprovisioned' })
  })

  it('an old failure with nothing open predates the sweep', () => {
    expect(decideIncident(job({ updatedAgeMs: FAILED_LOOKBACK_MS + MIN }), null)).toEqual({ action: 'none' })
    expect(decideIncident(job({ updatedAgeMs: FAILED_LOOKBACK_MS + MIN }), open())).toEqual({ action: 'ongoing' })
  })

  it('stays quiet while it lasts, including a resume that has not moved on', () => {
    expect(decideIncident(job(), open())).toEqual({ action: 'ongoing' })
    expect(decideIncident(job({ status: 'pending', stepAgeMs: 0 }), open())).toEqual({ action: 'ongoing' })
    expect(decideIncident(job({ status: 'pending', step: 'preflight' }), open())).toEqual({ action: 'ongoing' })
    expect(decideIncident(job({ status: 'pending', stepAgeMs: 31 * MIN }), open())).toEqual({ action: 'ongoing' })
  })

  it('recovers once the job moves past the step or finishes', () => {
    expect(decideIncident(job({ status: 'pending', step: 'attach_db_disk' }), open())).toEqual({ action: 'recover' })
    expect(decideIncident(job({ status: 'done', step: 'build_site' }), open({ kind: 'stuck' }))).toEqual({ action: 'recover' })
  })

  it('a stuck build that then fails on that step escalates once', () => {
    expect(decideIncident(job(), open({ kind: 'stuck' }))).toEqual({ action: 'open', kind: 'failed', escalated: true })
  })

  it('a fresh run is its own incident; it recovers the old one once past its step', () => {
    expect(decideIncident(job({ jobId: 'job-2' }), open())).toEqual({ action: 'open', kind: 'failed' })
    expect(decideIncident(job({ jobId: 'job-2', status: 'pending', step: 'preflight' }), open())).toEqual({ action: 'ongoing' })
    expect(decideIncident(job({ jobId: 'job-2', status: 'pending', step: 'load_schema' }), open())).toEqual({ action: 'recover' })
  })
})

describe('sweepProvisioningIncidents', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'job-1',
    tenant_id: 't-1',
    slug: 'acme',
    tenant_status: 'provisioning',
    status: 'failed',
    step: 'launch_server',
    last_error: 'launch_server: not ready within 15 min',
    pipeline: PIPE,
    rolled_back: true,
    stopped: false,
    step_age_ms: String(MIN),
    updated_age_ms: String(MIN),
    ...over,
  })
  let sent: Array<[string, string]>
  const sender = async (subject: string, body: string) => {
    sent.push([subject, body])
  }
  const setJob = (over: Record<string, unknown> = {}) => {
    db.state.jobs = [row(over)]
  }

  beforeEach(() => {
    db.state.events = []
    db.state.jobs = []
    db.state.lockFree = true
    sent = []
  })

  it('mails a failed build once, with slug, step, error and the admin link', async () => {
    setJob()
    expect(await sweepProvisioningIncidents(sender)).toEqual({ opened: 1, recovered: 0, closed: 0 })
    expect(sent).toHaveLength(1)
    const [subject, body] = sent[0]
    expect(subject).toBe('[Jeffi] Provisioning FAILED: acme')
    expect(body).toContain('Step   : launch_server')
    expect(body).toContain('launch_server: not ready within 15 min')
    expect(body).toContain('Rollback has run')
    expect(body).toContain(LINK)
    expect(db.state.events).toMatchObject([{ job_id: 'job-1', step: INCIDENT_STEP, status: 'warning', detail: { kind: 'failed', step: 'launch_server' } }])

    expect(await sweepProvisioningIncidents(sender)).toEqual({ opened: 0, recovered: 0, closed: 0 })
    expect(sent).toHaveLength(1)
  })

  it('sends one recovery once a resumed job moves on, then stays quiet', async () => {
    setJob()
    await sweepProvisioningIncidents(sender)
    setJob({ status: 'pending', last_error: null, step_age_ms: '0' })
    await sweepProvisioningIncidents(sender)
    expect(sent).toHaveLength(1)

    setJob({ status: 'pending', step: 'attach_db_disk', last_error: null, step_age_ms: '0' })
    expect(await sweepProvisioningIncidents(sender)).toEqual({ opened: 0, recovered: 1, closed: 0 })
    expect(sent).toHaveLength(2)
    expect(sent[1][0]).toBe('[Jeffi] Provisioning recovered: acme')
    expect(sent[1][1]).toContain('Was    : failed at launch_server')
    expect(sent[1][1]).toContain('Now    : at attach_db_disk (pending)')
    expect(sent[1][1]).toContain(LINK)
    expect(db.state.events.at(-1)).toMatchObject({ job_id: 'job-1', step: RECOVERED_STEP, status: 'ok' })

    await sweepProvisioningIncidents(sender)
    expect(sent).toHaveLength(2)
  })

  it('a stuck build alerts once, escalates once if it fails, recovers when a new run is done', async () => {
    setJob({ status: 'running', last_error: null, rolled_back: false, step_age_ms: String(31 * MIN) })
    await sweepProvisioningIncidents(sender)
    await sweepProvisioningIncidents(sender)
    expect(sent).toHaveLength(1)
    expect(sent[0][0]).toBe('[Jeffi] Provisioning stuck: acme at launch_server')
    expect(sent[0][1]).toContain('On step: 31 min (limit 30 min')

    setJob()
    await sweepProvisioningIncidents(sender)
    await sweepProvisioningIncidents(sender)
    expect(sent).toHaveLength(2)
    expect(sent[1][0]).toBe('[Jeffi] Provisioning FAILED: acme')
    expect(sent[1][1]).toContain('Reported stuck on this step since')

    setJob({ id: 'job-2', status: 'done', step: 'build_site', last_error: null })
    expect(await sweepProvisioningIncidents(sender)).toEqual({ opened: 0, recovered: 1, closed: 0 })
    expect(sent[2][1]).toContain('Now    : a new run is done')
    expect(sent).toHaveLength(3)
  })

  it('never alerts a stopped build, and closes an incident open before the stop without mail', async () => {
    setJob({ stopped: true, last_error: 'stopped: owner cancelled' })
    expect(await sweepProvisioningIncidents(sender)).toEqual({ opened: 0, recovered: 0, closed: 0 })
    expect(db.state.events).toEqual([])

    setJob()
    await sweepProvisioningIncidents(sender)
    setJob({ stopped: true })
    expect(await sweepProvisioningIncidents(sender)).toEqual({ opened: 0, recovered: 0, closed: 1 })
    expect(sent).toHaveLength(1)
    expect(db.state.events.at(-1)).toMatchObject({ step: RECOVERED_STEP, message: 'closed without alert: build stopped' })
  })

  it('stays out while another sweep holds the lock', async () => {
    setJob()
    db.state.lockFree = false
    expect(await sweepProvisioningIncidents(sender)).toMatchObject({ opened: 0, skipped: expect.any(String) })
    expect(sent).toEqual([])
  })
})
