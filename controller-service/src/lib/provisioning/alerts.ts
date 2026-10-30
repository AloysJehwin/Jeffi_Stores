import { controlPlanePool } from '@/lib/tenant-registry'
import { mailShell } from '@/lib/shared/mail-template'

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
    [String(STUCK_AFTER_MIN)]
  )
  return res.rows.map((r: any) => ({ ...r, stuck_minutes: Math.round(Number(r.stuck_minutes)) }))
}

// Absolute link to the platform admin's Ecom customers page (alerts are plain-text mail, where a
// bare path is not clickable). The admin host serves pages at the root.
async function ecomAdminUrl(): Promise<string> {
  const { currentAdminBaseUrlAsync } = await import('@/lib/catalog/brand')
  return `${await currentAdminBaseUrlAsync()}/ecom/customers`
}

export async function alertProvisioningFailure(
  tenantSlug: string,
  step: string,
  error: string,
  tenantId?: string
): Promise<void> {
  const where = `${await ecomAdminUrl()}${tenantId ? `/${tenantId}?tab=provisioning` : ''}`
  // owner_admin_cert and mtls_fleet_refresh run AFTER the job is already `done` — the store is
  // live and nothing is rolled back. Only a failure in the job's own step machine is terminal,
  // so only that case may claim a rollback; the post-done hooks get a re-run instruction.
  const nonFatal = step === 'owner_admin_cert' || step === 'mtls_fleet_refresh'
  const tail = nonFatal
    ? `The store is live; this post-provisioning step failed and can be safely re-run. Inspect at ${where}`
    : `The job is terminal and rollback has run. Inspect at ${where}`
  await send(
    `[Jeffi] Provisioning ${nonFatal ? 'step failed (store live)' : 'FAILED'}: ${tenantSlug}`,
    `Tenant : ${tenantSlug}\nStep   : ${step}\nError  : ${error}\n\n${tail}`
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
  const lines = jobs.map(
    j =>
      `- ${j.slug}: ${j.status} at ${j.step} (${j.attempts} ticks, idle ${j.stuck_minutes}m)` +
      (j.last_error ? `\n    ${j.last_error.slice(0, 200)}` : '')
  )
  await send(
    `[Jeffi] ${jobs.length} provisioning job(s) need attention`,
    `Failed or stuck for over ${STUCK_AFTER_MIN} minutes:\n\n${lines.join('\n')}\n\n${await ecomAdminUrl()}`
  )
  return jobs.length
}
