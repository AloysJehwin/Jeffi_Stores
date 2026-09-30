import { controlPlanePool } from './shared'

export interface ProvisioningJob {
  id: string
  tenant_id: string
  step: string
  status: string
  attempts: number
  last_error: string | null
  created_resources: Record<string, any>
  next_attempt_at?: string | null
  created_at: string
  updated_at: string
}

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
    `INSERT INTO provisioning_jobs (tenant_id, created_resources) VALUES ($1, $2::jsonb) RETURNING *`,
    [tenantId, JSON.stringify(created)]
  )
  return res.rows[0] as ProvisioningJob
}

export type ResumeOutcome =
  | { ok: true; resumedFrom: string }
  | { ok: false; reason: 'no_failed_job' | 'rolled_back' | 'already_running'; detail: string }

/**
 * Put a failed job back in the queue at the step it died on, keeping created_resources so the
 * worker skips what already succeeded.
 *
 * Refuses when rollback has run. Rollback DELETES the RDS instance, bucket and DNS it recorded,
 * so resuming at (say) ensure_compute would carry on against infrastructure that no longer
 * exists. Those runs have to start over — enqueueProvisioning already does that by opening a
 * fresh job.
 */
export async function resumeProvisioningJob(tenantId: string): Promise<ResumeOutcome> {
  const pool = controlPlanePool()
  const res = await pool.query(`SELECT * FROM provisioning_jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1`, [
    tenantId,
  ])
  const job = res.rows[0] as ProvisioningJob | undefined

  if (!job) return { ok: false, reason: 'no_failed_job', detail: 'This tenant has no provisioning job.' }
  if (job.status === 'pending' || job.status === 'running') {
    return { ok: false, reason: 'already_running', detail: `A job is already ${job.status} at "${job.step}".` }
  }
  if (job.status !== 'failed') {
    return { ok: false, reason: 'no_failed_job', detail: `The last job is "${job.status}", not failed.` }
  }
  if ((job.created_resources as Record<string, unknown> | null)?.rolledBack === true) {
    return {
      ok: false,
      reason: 'rolled_back',
      detail: `This run was rolled back — its database, bucket and DNS were deleted. Resuming at "${job.step}" would build on infrastructure that no longer exists; start a fresh provision instead.`,
    }
  }

  await pool.query(
    `UPDATE provisioning_jobs
        SET status='pending', last_error=NULL, next_attempt_at=NULL, updated_at=now()
      WHERE id=$1`,
    [job.id]
  )
  return { ok: true, resumedFrom: job.step }
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

/** Advance a job's step/status/resources. */
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
  }
): Promise<void> {
  const pool = controlPlanePool()
  const sets: string[] = ['updated_at = now()']
  const args: any[] = []
  if (patch.step !== undefined) {
    args.push(patch.step)
    sets.push(`step=$${args.length}`)
  }
  if (patch.status !== undefined) {
    args.push(patch.status)
    sets.push(`status=$${args.length}`)
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
  args.push(id)
  await pool.query(`UPDATE provisioning_jobs SET ${sets.join(', ')} WHERE id=$${args.length}`, args)
}

