import { controlPlanePool } from '../tenant-registry'

const STUCK_AFTER_MIN = 30

export interface StuckJob {
  id: string
  tenant_id: string
  slug: string
  status: string
  step: string
  attempts: number
  last_error: string | null
  updated_at: string
  stuck_minutes: number
}

async function send(subject: string, body: string): Promise<void> {
  const to = process.env.ADMIN_EMAIL || process.env.SUPPORT_EMAIL
  if (!to) return
  try {
    const { transporter } = await import('../email')
    await transporter.sendMail({
      from: process.env.SES_FROM_EMAIL || to,
      to,
      subject,
      text: body,
    })
  } catch (e: any) {
    console.error('[provisioning-alert] send failed:', e?.message || e)
  }
}

/** Jobs that failed, or have sat in pending/running past the stuck threshold. */
export async function findStuckJobs(): Promise<StuckJob[]> {
  const res = await controlPlanePool().query(
    `SELECT j.id, j.tenant_id, t.slug, j.status, j.step, j.attempts, j.last_error, j.updated_at,
            EXTRACT(EPOCH FROM (now() - j.updated_at))/60 AS stuck_minutes
     FROM provisioning_jobs j
     JOIN tenants t ON t.id = j.tenant_id
     WHERE j.status = 'failed'
        OR (j.status IN ('pending','running') AND j.updated_at < now() - ($1 || ' minutes')::interval)
     ORDER BY j.updated_at`,
    [String(STUCK_AFTER_MIN)],
  )
  return res.rows.map((r: any) => ({ ...r, stuck_minutes: Math.round(Number(r.stuck_minutes)) }))
}

export async function alertProvisioningFailure(tenantSlug: string, step: string, error: string): Promise<void> {
  await send(
    `[Jeffi] Provisioning FAILED: ${tenantSlug}`,
    `Tenant : ${tenantSlug}\nStep   : ${step}\nError  : ${error}\n\n` +
    `The job is terminal and rollback has run. Inspect at /admin/ecom/provisioning.`,
  )
}

/** Digest of failed/stuck jobs. Called from the reconcile sweep; silent when clean. */
export async function alertStuckJobs(): Promise<number> {
  let jobs: StuckJob[]
  try {
    jobs = await findStuckJobs()
  } catch (e: any) {
    console.error('[provisioning-alert] query failed:', e?.message || e)
    return 0
  }
  if (jobs.length === 0) return 0
  const lines = jobs.map((j) =>
    `- ${j.slug}: ${j.status} at ${j.step} (${j.attempts} ticks, idle ${j.stuck_minutes}m)` +
    (j.last_error ? `\n    ${j.last_error.slice(0, 200)}` : ''),
  )
  await send(
    `[Jeffi] ${jobs.length} provisioning job(s) need attention`,
    `Failed or stuck for over ${STUCK_AFTER_MIN} minutes:\n\n${lines.join('\n')}\n\n/admin/ecom/provisioning`,
  )
  return jobs.length
}
