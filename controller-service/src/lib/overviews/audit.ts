import type { FilterScope } from '@jeffi/list-filters'
import { queryMany, queryOne } from '@/lib/shared/db'
import type { Period } from '@/lib/overview/period'
import type { AttentionItem } from '@/lib/overview/attention'
import { kpi, n, periodSql, plural, type OverviewKpi } from './ops-kpi'

// Audit strip over admin_audit_log. Risky actions are deletes, imports and exports, plus any
// change to admin accounts, scopes or settings. Failed sign-ins come from failed_login_attempts,
// which only the storefront login writes; admin OTP failures are not recorded anywhere.

export const RISKY_ACTIONS = ['delete', 'import', 'export'] as const
export const RISKY_ENTITIES = [
  'admins',
  'admin_users',
  'users',
  'settings',
  'site_settings',
  'site_controls',
  'service_accounts',
] as const
const RISKY = `(l.action IN (${RISKY_ACTIONS.map(a => `'${a}'`).join(', ')}) OR l.entity_type IN (${RISKY_ENTITIES.map(a => `'${a}'`).join(', ')}))`
export const FAILED_SPIKE = 20

export function auditAttention(t: {
  risky: number
  deletes: number
  failed: number
  failed_admin: number
}): AttentionItem[] {
  const out: AttentionItem[] = []
  if (t.failed_admin)
    out.push({
      key: 'failed_admin',
      severity: 'critical',
      title: `${plural(t.failed_admin, 'failed sign-in')} using a team member's email`,
      href: '/admin/audit?view=list',
    })
  if (t.failed >= FAILED_SPIKE)
    out.push({
      key: 'failed',
      severity: 'warning',
      title: `${plural(t.failed, 'failed sign-in')} on the store`,
      sub: 'Check for credential stuffing',
      href: '/admin/audit?view=list',
    })
  if (t.deletes)
    out.push({
      key: 'deletes',
      severity: 'info',
      title: `${plural(t.deletes, 'delete')} in this period`,
      sub: 'Review that they were intended',
      href: '/admin/audit?view=list&action=delete',
    })
  else if (t.risky)
    out.push({
      key: 'risky',
      severity: 'info',
      title: `${plural(t.risky, 'risky action')} in this period`,
      href: '/admin/audit?view=list&risky=true',
    })
  return out
}

/** `scope`: the audit list's filters (except its date) on l; failed sign-ins are not audit rows. */
export async function getAuditOverview(period: Period, scope?: FilterScope) {
  const ps = periodSql(period)
  const s5 = scope?.and(5) ?? { sql: '', params: [] }
  const s3 = scope?.and(3) ?? { sql: '', params: [] }
  const [totals, failed, byAdmin, byType] = await Promise.all([
    queryOne<Record<string, unknown>>(
      `SELECT COUNT(*) FILTER (WHERE ${ps.cur('l.created_at')}) AS actions,
              COUNT(*) FILTER (WHERE ${ps.prev('l.created_at')}) AS prev_actions,
              COUNT(DISTINCT l.admin_id) FILTER (WHERE ${ps.cur('l.created_at')}) AS admins,
              COUNT(DISTINCT l.admin_id) FILTER (WHERE ${ps.prev('l.created_at')}) AS prev_admins,
              COUNT(*) FILTER (WHERE ${ps.cur('l.created_at')} AND ${RISKY}) AS risky,
              COUNT(*) FILTER (WHERE ${ps.prev('l.created_at')} AND ${RISKY}) AS prev_risky,
              COUNT(*) FILTER (WHERE ${ps.cur('l.created_at')} AND l.action = 'delete') AS deletes
       FROM admin_audit_log l WHERE ${ps.span('l.created_at')}${s5.sql}`,
      [...ps.params, ...s5.params]
    ),
    queryOne<Record<string, unknown>>(
      `SELECT COUNT(*) FILTER (WHERE ${ps.cur('f.created_at')}) AS failed,
              COUNT(*) FILTER (WHERE ${ps.prev('f.created_at')}) AS prev_failed,
              COUNT(*) FILTER (WHERE ${ps.cur('f.created_at')} AND lower(f.email) IN (
                SELECT lower(u.email) FROM admins a JOIN users u ON u.id = a.user_id WHERE u.email IS NOT NULL)) AS failed_admin
       FROM failed_login_attempts f WHERE ${ps.span('f.created_at')}`,
      ps.params
    ),
    queryMany<Record<string, unknown>>(
      `SELECT l.admin_id, COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email, 'System') AS name,
              COUNT(*) AS actions, COUNT(*) FILTER (WHERE ${RISKY}) AS risky
       FROM admin_audit_log l LEFT JOIN admins a ON a.id = l.admin_id LEFT JOIN users u ON u.id = a.user_id
       WHERE ${ps.cur('l.created_at')}${s3.sql}
       GROUP BY l.admin_id, u.first_name, u.last_name, u.email ORDER BY actions DESC LIMIT 6`,
      [...ps.params.slice(0, 2), ...s3.params]
    ),
    queryMany<Record<string, unknown>>(
      `SELECT l.action, COUNT(*) AS actions FROM admin_audit_log l WHERE ${ps.cur('l.created_at')}${s3.sql}
       GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
      [...ps.params.slice(0, 2), ...s3.params]
    ),
  ])
  const t = {
    risky: n(totals?.risky),
    deletes: n(totals?.deletes),
    failed: n(failed?.failed),
    failed_admin: n(failed?.failed_admin),
  }
  const kpis: OverviewKpi[] = [
    kpi('actions', 'Actions logged', n(totals?.actions), n(totals?.prev_actions), 'count'),
    kpi('admins', 'Members acting', n(totals?.admins), n(totals?.prev_admins), 'count'),
    kpi('risky', 'Risky actions', t.risky, n(totals?.prev_risky), 'count', {
      invert: true,
      sub: 'Deletes, imports, exports, access',
    }),
    kpi('failed', 'Failed sign-ins', t.failed, n(failed?.prev_failed), 'count', { invert: true, sub: 'Store login' }),
  ]
  return {
    range: period,
    previous_range: ps.previous,
    kpis,
    by_admin: byAdmin.map(r => ({
      admin_id: (r.admin_id as string | null) ?? null,
      name: String(r.name),
      actions: n(r.actions),
      risky: n(r.risky),
    })),
    by_action: byType.map(r => ({ action: String(r.action), actions: n(r.actions) })),
    filtered: !!s3.sql,
    attention: auditAttention(t),
  }
}
