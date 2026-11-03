import { queryOne } from '@/lib/shared/db'
import { ratio, type Period } from '@/lib/overview/period'
import type { AttentionItem } from '@/lib/overview/attention'
import { kpi, n, periodSql, plural, snapshot, type OverviewKpi } from './ops-kpi'

// Team strip. Sign-ins are admin sessions opened (auth_sessions); an admin is active in the
// period if a session of theirs was opened or used in it. Platform owners count like anyone.

export const IDLE_DAYS = 30
export const CERT_SOON_DAYS = 30

export interface TeamSnapshot {
  admins: number
  active: number
  mfa: number
  no_mfa: number
  idle: number
  certs_expiring: number
  low_recovery: number
}

export function teamAttention(s: TeamSnapshot): AttentionItem[] {
  const out: AttentionItem[] = []
  if (s.no_mfa)
    out.push({
      key: 'mfa',
      severity: 'critical',
      title: `${plural(s.no_mfa, 'active member')} without two-factor sign-in`,
      href: '/admin/team?view=list',
    })
  if (s.certs_expiring)
    out.push({
      key: 'certs',
      severity: 'warning',
      title: `${plural(s.certs_expiring, 'certificate')} expiring within ${CERT_SOON_DAYS} days`,
      sub: 'Reissue before it lapses or the member is locked out',
      href: '/admin/team?view=list',
    })
  if (s.low_recovery)
    out.push({
      key: 'recovery',
      severity: 'warning',
      title: `${plural(s.low_recovery, 'member')} with fewer than 3 recovery codes left`,
      href: '/admin/team?view=list',
    })
  if (s.idle)
    out.push({
      key: 'idle',
      severity: 'info',
      title: `${plural(s.idle, 'active member')} not signed in for ${IDLE_DAYS} days`,
      sub: 'Consider deactivating unused accounts',
      href: '/admin/team?view=list',
    })
  return out
}

export async function getTeamOverview(period: Period) {
  const ps = periodSql(period)
  const [snap, flow] = await Promise.all([
    queryOne<Record<string, unknown>>(
      `SELECT COUNT(*) AS admins,
              COUNT(*) FILTER (WHERE a.is_active IS NOT FALSE) AS active,
              COUNT(*) FILTER (WHERE a.is_active IS NOT FALSE AND a.mfa_enabled) AS mfa,
              COUNT(*) FILTER (WHERE a.is_active IS NOT FALSE AND NOT a.mfa_enabled) AS no_mfa,
              COUNT(*) FILTER (WHERE a.is_active IS NOT FALSE AND COALESCE(a.last_login, a.created_at) < now() - interval '${IDLE_DAYS} days') AS idle,
              COUNT(*) FILTER (WHERE a.is_active IS NOT FALSE AND EXISTS (
                SELECT 1 FROM admin_certificates c WHERE c.admin_id = a.id AND NOT COALESCE(c.is_revoked, false)
                  AND c.expires_at BETWEEN now() AND now() + interval '${CERT_SOON_DAYS} days'
                  AND NOT EXISTS (SELECT 1 FROM admin_certificates c2 WHERE c2.admin_id = a.id AND NOT COALESCE(c2.is_revoked, false) AND c2.expires_at > c.expires_at))) AS certs_expiring,
              COUNT(*) FILTER (WHERE a.is_active IS NOT FALSE AND a.mfa_enabled AND
                (SELECT COUNT(*) FROM admin_mfa_recovery_codes r WHERE r.admin_id = a.id AND r.used_at IS NULL) < 3) AS low_recovery
       FROM admins a`
    ),
    queryOne<Record<string, unknown>>(
      `SELECT COUNT(*) FILTER (WHERE ${ps.cur('s.created_at')}) AS signins,
              COUNT(*) FILTER (WHERE ${ps.prev('s.created_at')}) AS prev_signins,
              COUNT(DISTINCT s.principal_id) FILTER (WHERE ${ps.cur('s.created_at')} OR ${ps.cur('s.last_seen_at')}) AS active,
              COUNT(DISTINCT s.principal_id) FILTER (WHERE ${ps.prev('s.created_at')} OR ${ps.prev('s.last_seen_at')}) AS prev_active
       FROM auth_sessions s JOIN admins a ON a.id = s.principal_id
       WHERE s.principal_type = 'admin' AND (${ps.span('s.created_at')} OR ${ps.span('s.last_seen_at')})`,
      ps.params
    ),
  ])
  const s: TeamSnapshot = {
    admins: n(snap?.admins),
    active: n(snap?.active),
    mfa: n(snap?.mfa),
    no_mfa: n(snap?.no_mfa),
    idle: n(snap?.idle),
    certs_expiring: n(snap?.certs_expiring),
    low_recovery: n(snap?.low_recovery),
  }
  const kpis: OverviewKpi[] = [
    snapshot('members', 'Active members', s.active, 'count', { sub: `${s.admins} total` }),
    kpi('active', 'Active in period', n(flow?.active), n(flow?.prev_active), 'count'),
    kpi('signins', 'Sign-ins', n(flow?.signins), n(flow?.prev_signins), 'count'),
    snapshot('mfa', 'MFA coverage', ratio(s.mfa, s.active), 'pct', { sub: `${s.mfa} of ${s.active}` }),
  ]
  return { range: period, previous_range: ps.previous, kpis, snapshot: s, attention: teamAttention(s) }
}
