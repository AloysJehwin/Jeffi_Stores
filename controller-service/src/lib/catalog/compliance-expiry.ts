import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { EXPIRY_REMINDER_DAYS, todayIst } from './compliance'
import { CONSOLE_STATUSES, notifyExpiry, type ExpiryNotice } from './compliance-notify'

// The daily compliance_expiry job (CRON_JOBS): marks lapsed licences expired, so the platform admin's KYC tab and the
// owner's Licences & certificates page both show it, and emails the owner 30 and 7 days before a licence lapses and once
// it has. A notice is claimed on its row (expiry_notice for expiry_notice_for) before it is sent, so a rerun or an
// overlapping run sends it once, and only the latest notice due goes when runs were missed. A document sent again with a
// new date starts over. Only stores with a console are emailed (compliance-notify.ts CONSOLE_STATUSES).

const [FAR, NEAR] = EXPIRY_REMINDER_DAYS

export interface ComplianceExpiryRun {
  /** Documents marked expired by this run. */
  expired: number
  /** Notices claimed (one per document and milestone). */
  notices: number
  /** Emails sent (one per store owner). */
  emails: number
  failed: { tenantId: string; error: string }[]
}

interface DueRow extends ExpiryNotice {
  id: string
  tenant_id: string
  email: string
  name: string | null
  display_name: string
}

export async function runComplianceExpiry(today = todayIst()): Promise<ComplianceExpiryRun> {
  const pool = controlPlanePool()
  // A rejected one already waits on the owner and keeps its reason.
  const expired = await pool.query(
    `UPDATE tenant_compliance_documents SET status = 'expired' WHERE expires_on < $1::date AND status IN ('pending', 'approved')`,
    [today]
  )

  const due = await pool.query<DueRow>(
    `WITH due AS (
       SELECT d.id, CASE WHEN d.expires_on < $1::date THEN 0 WHEN d.expires_on <= $1::date + $3::int THEN $3::int ELSE $2::int END AS notice,
              o.email, o.name, t.display_name
         FROM tenant_compliance_documents d
         JOIN tenants t ON t.id = d.tenant_id
         JOIN owners o ON o.id = d.owner_id
        WHERE d.expires_on <= $1::date + $2::int AND t.status = ANY($4::text[])
     )
     UPDATE tenant_compliance_documents d SET expiry_notice = due.notice, expiry_notice_for = d.expires_on
       FROM due
      WHERE d.id = due.id AND (d.expiry_notice_for IS DISTINCT FROM d.expires_on OR d.expiry_notice > due.notice)
     RETURNING d.id, d.tenant_id, d.doc_type, d.doc_number, to_char(d.expires_on, 'YYYY-MM-DD') AS expires_on, due.notice,
               due.email, due.name, due.display_name`,
    [today, FAR, NEAR, CONSOLE_STATUSES]
  )

  const run: ComplianceExpiryRun = { expired: expired.rowCount ?? 0, notices: due.rows.length, emails: 0, failed: [] }
  const byStore = new Map<string, DueRow[]>()
  for (const r of due.rows) {
    const key = `${r.tenant_id}:${r.email}`
    byStore.set(key, [...(byStore.get(key) ?? []), r])
  }
  for (const rows of byStore.values()) {
    const [first] = rows
    try {
      await notifyExpiry({ email: first.email, name: first.name }, first.display_name, rows, today)
      run.emails++
    } catch (e) {
      run.failed.push({ tenantId: first.tenant_id, error: String((e as Error)?.message || e) })
    }
  }
  return run
}
