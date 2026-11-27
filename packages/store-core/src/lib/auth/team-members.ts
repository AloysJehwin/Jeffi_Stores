import 'server-only'
import { queryMany } from '@/lib/shared/db'
import { controlPlanePool } from '@/lib/tenant-registry'
import { isPlatformOwner } from '@/lib/auth/scopes'

/** Every team member (service accounts excluded) with their certificates: the Team tab and its export. */
export async function getAllAdmins() {
  return queryMany(`
    SELECT a.id, a.role, a.scopes, a.is_active, a.created_at, a.last_login,
      a.mfa_enabled, a.idle_timeout_minutes,
      CASE WHEN a.mobile_verified_at IS NOT NULL
        THEN TRIM(LEFT(a.mobile, GREATEST(LENGTH(a.mobile) - 10, 0)) || ' ••••••' || RIGHT(a.mobile, 4)) END AS mobile_hint,
      (SELECT COUNT(*) FROM admin_mfa_recovery_codes WHERE admin_id = a.id AND used_at IS NULL) AS mfa_recovery_codes_remaining,
      u.first_name, u.last_name,
      COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS username,
      (SELECT json_agg(json_build_object(
        'serial_number', ac.serial_number,
        'expires_at', ac.expires_at,
        'is_revoked', ac.is_revoked,
        'downloaded_at', ac.downloaded_at
      ) ORDER BY ac.created_at DESC) FROM admin_certificates ac WHERE ac.admin_id = a.id) AS certificates
    FROM admins a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE a.role IS DISTINCT FROM 'service_account'
    ORDER BY a.created_at DESC
  `)
}

// The portal writes downloaded_at/revoked_at to the CENTRAL portal_certs (control plane), not the
// store-local admin_certificates. Overlay that central state onto each cert by serial so the team
// page reflects a portal download/revoke. Best-effort: if the control plane is unreachable, the
// store-local flags stand.
export async function overlayPortalState(admins: any[]): Promise<void> {
  const serials = admins
    .flatMap((a: any) => (a.certificates as any[] | null) || [])
    .map((c: any) => c?.serial_number)
    .filter(Boolean)
  if (serials.length === 0) return
  try {
    const { rows } = await controlPlanePool().query(
      `SELECT lower(serial) AS serial, downloaded_at, revoked_at FROM portal_certs
        WHERE lower(serial) = ANY($1::text[])`,
      [serials.map((s: string) => s.toLowerCase())]
    )
    const byId = new Map(rows.map((r: any) => [r.serial, r]))
    for (const a of admins) {
      for (const c of (a.certificates as any[] | null) || []) {
        const central = byId.get(String(c.serial_number).toLowerCase())
        if (!central) continue
        if (central.downloaded_at && !c.downloaded_at) c.downloaded_at = central.downloaded_at
        if (central.revoked_at && !c.is_revoked) c.is_revoked = true
      }
    }
  } catch {
    // control plane unreachable — keep store-local flags
  }
}

export function certStatus(admin: any): string {
  const certs = admin.certificates as any[] | null
  if (!certs || certs.length === 0) return 'No Certificate'
  const latest = certs[0]
  if (latest.is_revoked) return 'Revoked'
  if (new Date(latest.expires_at) < new Date()) return 'Expired'
  if (latest.downloaded_at) return 'Active'
  // Platform-owner roles (super_admin / administrator) administer directly and are treated as
  // provisioned — their certificate is not gated on a portal download.
  if (isPlatformOwner(admin.role)) return 'Active'
  return 'Pending Download'
}
