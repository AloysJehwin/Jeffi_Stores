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

/**
 * Provisioning alerts go through the audited mail service like everything else.
 *
 * These used to build their own transporter call, so they never appeared in
 * /admin/audit?tab=mail_log — the one place to check what the platform has sent — and were
 * plain text, unreadable next to every other mail the system produces.
 */
async function send(subject: string, body: string): Promise<void> {
  const { platformAdminEmail, adminMailFrom } = await import('../brand')
  const to = platformAdminEmail()
  if (!to) return
  try {
    const { sendAuditedMail } = await import('../mail-audit')
    await sendAuditedMail({
      to,
      from: adminMailFrom(),
      subject,
      text: body,
      html: alertHtml(subject, body),
      kind: 'provisioning_alert',
    })
  } catch (e: any) {
    console.error('[provisioning-alert] send failed:', e?.message || e)
  }
}

/** Operational alert: monospaced body so step names, ids and errors stay readable. */
function alertHtml(subject: string, body: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#f5f5f5;font-family:Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
    <div style="background:#b91c1c;padding:18px 24px">
      <div style="font-size:18px;font-weight:bold;color:#ffffff">${esc(subject)}</div>
    </div>
    <div style="padding:22px 24px">
      <pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.55;color:#111827">${esc(body)}</pre>
    </div>
    <div style="padding:14px 24px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px">
      Automated provisioning alert.
    </div>
  </div></body></html>`
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

export async function alertProvisioningFailure(
  tenantSlug: string, step: string, error: string, tenantId?: string,
): Promise<void> {
  const where = tenantId
    ? `/admin/ecom/customers/${tenantId}?tab=provisioning`
    : '/admin/ecom/customers'
  await send(
    `[Jeffi] Provisioning FAILED: ${tenantSlug}`,
    `Tenant : ${tenantSlug}\nStep   : ${step}\nError  : ${error}\n\n` +
    `The job is terminal and rollback has run. Inspect at ${where}`,
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
    `Failed or stuck for over ${STUCK_AFTER_MIN} minutes:\n\n${lines.join('\n')}\n\n/admin/ecom/customers`,
  )
  return jobs.length
}
