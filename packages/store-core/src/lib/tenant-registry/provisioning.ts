import { controlPlanePool } from './shared'
import type { TenantArchive } from './archives'

/** provisioning_step_events.step of the row stopProvisioningJob writes. */
export const STOPPED_STEP = 'stopped'

// A stopped job: its stop event, or a last_error starting "stopped" (the engine's deprovisioned-store guard writes only that).
const stoppedSql = (j: string) =>
  `(${j}.last_error LIKE 'stopped%' OR EXISTS (SELECT 1 FROM provisioning_step_events se WHERE se.job_id = ${j}.id AND se.step = '${STOPPED_STEP}'))`

export interface ProvisioningJob {
  id: string
  tenant_id: string
  step: string
  status: string
  attempts: number
  last_error: string | null
  created_resources: Record<string, any>
  next_attempt_at?: string | null
  /** The pinned pipeline (controller provisioning/pipeline.ts PipelineDef); null = legacy or not pinned yet. */
  pipeline?: PinnedPipeline | null
  /** When the current step started. */
  step_started_at?: string | null
  created_at: string
  updated_at: string
}

export interface PinnedPipeline {
  v: number
  jobs: { id: string; label: string; steps: { id: string; label: string }[] }[]
}

// Per-step wait clocks: a resumed job starts each wait afresh instead of inheriting a deadline that already passed.
const RESUME_CLEARED_KEYS = ['dbWaitStartedAt', 'computeWaitStartedAt', 'verifyStartedAt', 'verifyAttempts', 'stepDetail', 'stepWaitStartedAt']

/** Create (or return existing pending) provisioning job for a tenant. */
export async function enqueueProvisioning(
  tenantId: string,
  opts?: { restoreFromKey?: string }
): Promise<ProvisioningJob> {
  const pool = controlPlanePool()
  const existing = await pool.query(
    `SELECT * FROM provisioning_jobs WHERE tenant_id=$1 AND status IN ('pending','running') LIMIT 1`,
    [tenantId]
  )
  if (existing.rows[0]) return existing.rows[0] as ProvisioningJob
  const created = opts?.restoreFromKey ? { restoreFromKey: opts.restoreFromKey } : {}
  const res = await pool.query(
    `INSERT INTO provisioning_jobs (tenant_id, created_resources, step_started_at) VALUES ($1, $2::jsonb, now()) RETURNING *`,
    [tenantId, JSON.stringify(created)]
  )
  return res.rows[0] as ProvisioningJob
}

export type ResumeOutcome =
  | { ok: true; resumedFrom: string }
  | { ok: false; reason: 'no_failed_job' | 'rolled_back' | 'already_running' | 'bad_step' | 'stopped'; detail: string }

/**
 * Put a failed job back in the queue at the step it died on, keeping created_resources so the
 * worker skips what already succeeded.
 *
 * Refuses when rollback has run. Rollback DELETES the RDS instance, bucket and DNS it recorded,
 * so resuming at (say) ensure_compute would carry on against infrastructure that no longer
 * exists. Those runs have to start over — enqueueProvisioning already does that by opening a
 * fresh job.
 *
 * `fromStep` re-runs from an earlier step of the job's pipeline (pinned, else `legacySteps`).
 * A stopped build, or any build of a deprovisioned store, is never resumed: the store is re-onboarded instead.
 */
export async function resumeProvisioningJob(
  tenantId: string,
  opts: { fromStep?: string; legacySteps?: readonly string[] } = {}
): Promise<ResumeOutcome> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT j.*, ${stoppedSql('j')} AS stopped, t.status AS tenant_status
       FROM provisioning_jobs j LEFT JOIN tenants t ON t.id = j.tenant_id
      WHERE j.tenant_id=$1 ORDER BY j.created_at DESC LIMIT 1`,
    [tenantId]
  )
  const job = res.rows[0] as (ProvisioningJob & { stopped?: boolean; tenant_status?: string | null }) | undefined

  if (!job) return { ok: false, reason: 'no_failed_job', detail: 'This tenant has no provisioning job.' }
  if (job.status === 'pending' || job.status === 'running') {
    return { ok: false, reason: 'already_running', detail: `A job is already ${job.status} at "${job.step}".` }
  }
  if (job.status !== 'failed') {
    return { ok: false, reason: 'no_failed_job', detail: `The last job is "${job.status}", not failed.` }
  }
  if (job.stopped || job.tenant_status === 'terminated') {
    return {
      ok: false,
      reason: 'stopped',
      detail: job.stopped
        ? `This build was stopped at "${job.step}" and the store deprovisioned. Its owner sets the store up again from the console.`
        : 'This store is deprovisioned. Its owner sets the store up again from the console.',
    }
  }
  if ((job.created_resources as Record<string, unknown> | null)?.rolledBack === true) {
    return {
      ok: false,
      reason: 'rolled_back',
      detail: `This run was rolled back — its database, bucket and DNS were deleted. Resuming at "${job.step}" would build on infrastructure that no longer exists; start a fresh provision instead.`,
    }
  }

  let step = job.step
  if (opts.fromStep) {
    const steps = job.pipeline?.jobs?.length ? job.pipeline.jobs.flatMap(j => j.steps.map(s => s.id)) : (opts.legacySteps ?? [])
    const at = steps.indexOf(opts.fromStep)
    if (at < 0 || at > steps.indexOf(job.step)) {
      return { ok: false, reason: 'bad_step', detail: `"${opts.fromStep}" is not a step at or before "${job.step}" in this job.` }
    }
    step = opts.fromStep
  }

  await pool.query(
    `UPDATE provisioning_jobs
        SET status='pending', step=$2, last_error=NULL, next_attempt_at=NULL, updated_at=now(), step_started_at=now(),
            created_resources = created_resources - $3::text[]
      WHERE id=$1`,
    [job.id, step, RESUME_CLEARED_KEYS]
  )
  return { ok: true, resumedFrom: step }
}

/**
 * Stop the tenant's build (deprovisioned while it runs): waits up to `waitMs` for a step in flight to finish, so nothing
 * is created after the teardown, then fails the job so the worker leaves it. Returns whether a build was stopped.
 * A stopped job stays failed: updateProvisioningJob never moves it on, and resumeProvisioningJob refuses it.
 */
export async function stopProvisioningJob(tenantId: string, reason: string, waitMs = 60_000): Promise<boolean> {
  const pool = controlPlanePool()
  const until = Date.now() + waitMs
  const why = /^stopped\b/.test(reason) ? reason : `stopped: ${reason}`
  for (;;) {
    const job = (
      await pool.query<{ id: string; status: string }>(
        `SELECT id, status FROM provisioning_jobs WHERE tenant_id=$1 AND status IN ('pending','running') ORDER BY created_at DESC LIMIT 1`,
        [tenantId]
      )
    ).rows[0]
    if (!job) return false
    if (job.status === 'running' && Date.now() < until) {
      await new Promise(r => setTimeout(r, 2000))
      continue
    }
    const stopped = await pool.query(
      `UPDATE provisioning_jobs SET status='failed', last_error=$2, next_attempt_at=NULL, updated_at=now() WHERE id=$1 AND status IN ('pending','running') RETURNING id`,
      [job.id, why]
    )
    // Finished or picked up meanwhile: look again.
    if (!stopped.rowCount) continue
    // The durable marker: last_error can be overwritten later (a rollback, a failed teardown).
    await pool
      .query(
        `INSERT INTO provisioning_step_events (job_id, tenant_id, step, status, message) VALUES ($1, $2, $3, 'warning', $4)`,
        [job.id, tenantId, STOPPED_STEP, why]
      )
      .catch(() => {})
    return true
  }
}

/** Fetch active jobs the worker should advance (skips jobs backing off until next_attempt_at). */
export async function activeProvisioningJobs(): Promise<ProvisioningJob[]> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT * FROM provisioning_jobs
     WHERE status IN ('pending','running')
       AND (next_attempt_at IS NULL OR next_attempt_at <= now())
     ORDER BY created_at`
  )
  return res.rows as ProvisioningJob[]
}

export interface ProvisioningJobRow extends ProvisioningJob {
  slug: string
  display_name: string
  tenant_status: string
  plan: string | null
}

/** Latest provisioning job per tenant, for the provisioning list page. */
export async function listProvisioningJobs(filters?: { status?: string; q?: string }): Promise<ProvisioningJobRow[]> {
  const pool = controlPlanePool()
  const where: string[] = []
  const args: any[] = []
  if (filters?.status) {
    args.push(filters.status)
    where.push(`j.status = $${args.length}`)
  }
  if (filters?.q) {
    args.push(`%${filters.q.toLowerCase()}%`)
    where.push(`(lower(t.display_name) LIKE $${args.length} OR lower(t.slug) LIKE $${args.length})`)
  }
  const res = await pool.query(
    `SELECT DISTINCT ON (j.tenant_id) j.*, t.slug, t.display_name, t.status AS tenant_status, p.slug AS plan
     FROM provisioning_jobs j
     JOIN tenants t ON t.id = j.tenant_id
     LEFT JOIN plans p ON p.id = t.plan_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY j.tenant_id, j.created_at DESC`,
    args
  )
  return (res.rows as ProvisioningJobRow[]).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
}

export async function provisioningSummary(): Promise<{ total: number; running: number; failed: number; done: number }> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status IN ('pending','running'))::int AS running,
            count(*) FILTER (WHERE status='failed')::int AS failed,
            count(*) FILTER (WHERE status='done')::int AS done
     FROM (SELECT DISTINCT ON (tenant_id) status FROM provisioning_jobs ORDER BY tenant_id, created_at DESC) s`
  )
  return res.rows[0]
}

export async function getProvisioningJobById(jobId: string): Promise<ProvisioningJobRow | null> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT j.*, t.slug, t.display_name, t.status AS tenant_status, p.slug AS plan
     FROM provisioning_jobs j
     JOIN tenants t ON t.id = j.tenant_id
     LEFT JOIN plans p ON p.id = t.plan_id
     WHERE j.id = $1`,
    [jobId]
  )
  return (res.rows[0] as ProvisioningJobRow) || null
}

export async function getProvisioningJob(tenantId: string): Promise<ProvisioningJob | null> {
  const pool = controlPlanePool()
  const res = await pool.query(`SELECT * FROM provisioning_jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1`, [
    tenantId,
  ])
  return (res.rows[0] as ProvisioningJob) || null
}

/**
 * Advance a job's step/status/resources. A stopped job's status stays 'failed' whatever the patch says, so a step that
 * was in flight when the stop landed, a later tick or the deprovision cannot mark it running, pending or done.
 * Returns the job's status after the write (undefined for an unknown id).
 */
export async function updateProvisioningJob(
  id: string,
  patch: {
    step?: string
    status?: string
    last_error?: string | null
    created_resources?: Record<string, any>
    bumpAttempts?: boolean
    nextAttemptAt?: Date | null
    clearNextAttempt?: boolean
    pipeline?: PinnedPipeline | null
    /** The step starts now (step_started_at = now()). */
    stepStarted?: true
  }
): Promise<string | undefined> {
  const pool = controlPlanePool()
  const sets: string[] = ['updated_at = now()']
  const args: any[] = []
  if (patch.step !== undefined) {
    args.push(patch.step)
    sets.push(`step=$${args.length}`)
  }
  if (patch.status !== undefined) {
    args.push(patch.status)
    sets.push(`status=CASE WHEN provisioning_jobs.status = 'failed' AND ${stoppedSql('provisioning_jobs')} THEN 'failed' ELSE $${args.length} END`)
  }
  if (patch.last_error !== undefined) {
    args.push(patch.last_error)
    sets.push(`last_error=$${args.length}`)
  }
  if (patch.created_resources !== undefined) {
    args.push(JSON.stringify(patch.created_resources))
    sets.push(`created_resources=$${args.length}::jsonb`)
  }
  if (patch.bumpAttempts) sets.push('attempts = attempts + 1')
  if (patch.nextAttemptAt !== undefined && patch.nextAttemptAt !== null) {
    args.push(patch.nextAttemptAt.toISOString())
    sets.push(`next_attempt_at=$${args.length}`)
  }
  if (patch.clearNextAttempt) sets.push('next_attempt_at = NULL')
  if (patch.pipeline !== undefined) {
    args.push(patch.pipeline === null ? null : JSON.stringify(patch.pipeline))
    sets.push(`pipeline=$${args.length}::jsonb`)
  }
  if (patch.stepStarted) sets.push('step_started_at = now()')
  args.push(id)
  const r = await pool.query(`UPDATE provisioning_jobs SET ${sets.join(', ')} WHERE id=$${args.length} RETURNING status`, args)
  return r.rows[0]?.status
}

/** Tenants whose k8s plan change is parked until their new node joins (steps.reconcileK8sPlan). */
export async function pendingK8sPlanTenants(): Promise<string[]> {
  const res = await controlPlanePool().query(
    `SELECT tenant_id FROM provisioning_jobs WHERE created_resources ? 'k8sPendingPlan' ORDER BY updated_at`
  )
  return res.rows.map((r: { tenant_id: string }) => r.tenant_id)
}

export type SetupOutcomeState = 'stopped' | 'deprovisioned' | 'archived'

/** Where a stopped or closed store stands for its owner (the ecom console shows this instead of the build). */
export interface SetupOutcome {
  /** archived: closed, with data kept that can still be restored; stopped: closed before it went live; deprovisioned: closed. */
  state: SetupOutcomeState
  /** It had gone live before it was closed (its build activated it). */
  wentLive: boolean
  /** Deprovisioned; false only while a stopped build's teardown is starting. */
  closed: boolean
  closedAt: string | null
  /** What was kept, while it can still be restored. */
  archive: { id: string; expiresAt: string; database: boolean; media: boolean; config: boolean } | null
  /** The owner can apply again: it is closed and no other store or workspace of theirs is open. */
  reapply: boolean
}

type When = string | Date | null | undefined
const iso = (w: When): string | null => {
  if (w === null || w === undefined) return null
  const t = new Date(w).getTime()
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

export interface SetupOutcomeInput {
  tenantStatus: string
  /** The tenant's latest job; `stopped`/`activated` as loadSetupOutcome reads them. */
  job: { status: string; last_error?: string | null; updated_at?: When; stopped?: boolean; activated?: boolean } | null
  /** The store's newest archive for this owner, any status. */
  archive: Pick<TenantArchive, 'id' | 'status' | 'keep_database' | 'keep_media' | 'keep_config'> & { expires_at: When; created_at: When } | null
  reapply: boolean
}

/** Pure. Null while the store is neither stopped nor closed. */
export function setupOutcome({ tenantStatus, job, archive, reapply }: SetupOutcomeInput, now = Date.now()): SetupOutcome | null {
  const stopped = !!job && (job.stopped === true || /^stopped\b/.test(job.last_error ?? ''))
  const closed = tenantStatus === 'terminated'
  if (!closed && !stopped) return null
  // A stopped job that was later marked done (before stops stuck) did not go live.
  const wentLive = !!job && (job.activated === true || (job.status === 'done' && !stopped))
  const expires = archive ? new Date(archive.expires_at ?? 0).getTime() : 0
  const kept = closed && archive && archive.status === 'available' && expires > now ? archive : null
  return {
    state: kept ? 'archived' : job && !wentLive ? 'stopped' : 'deprovisioned',
    wentLive,
    closed,
    closedAt: closed ? iso(archive?.created_at ?? job?.updated_at) : null,
    archive: kept
      ? { id: kept.id, expiresAt: iso(kept.expires_at) as string, database: kept.keep_database, media: kept.keep_media, config: kept.keep_config }
      : null,
    reapply: reapply && closed,
  }
}

/** The owner-facing outcome of a store; `ownerTenants` (getOwnerTenants) decides whether they can apply again. */
export async function loadSetupOutcome(
  tenant: { id: string; status: string },
  ownerId: string,
  ownerTenants: { id: string; status: string }[]
): Promise<SetupOutcome | null> {
  const pool = controlPlanePool()
  const job =
    (
      await pool.query(
        `SELECT j.status, j.last_error, j.updated_at, ${stoppedSql('j')} AS stopped,
                EXISTS (SELECT 1 FROM provisioning_step_events ae
                         WHERE ae.job_id = j.id AND ae.step = 'activate' AND ae.status IN ('ok','warning')) AS activated
           FROM provisioning_jobs j WHERE j.tenant_id = $1 ORDER BY j.created_at DESC LIMIT 1`,
        [tenant.id]
      )
    ).rows[0] ?? null
  const reapply = ownerTenants.every(t => t.id === tenant.id || t.status === 'terminated')
  const first = setupOutcome({ tenantStatus: tenant.status, job, archive: null, reapply })
  if (!first?.closed) return first
  const archive =
    (
      await pool.query(
        `SELECT id, status, expires_at, created_at, keep_database, keep_media, keep_config
           FROM tenant_archives WHERE tenant_id = $1 AND owner_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [tenant.id, ownerId]
      )
    ).rows[0] ?? null
  return setupOutcome({ tenantStatus: tenant.status, job, archive, reapply })
}
