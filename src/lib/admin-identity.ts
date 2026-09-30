import { queryOne, query } from '@/lib/db'
import { isPlatformOwner } from '@/lib/scopes'

const PLATFORM_OWNER_EMAIL = (process.env.PLATFORM_OWNER_EMAIL || 'admin@jeffistores.in').toLowerCase()

// Shared helpers for the admin identity layer (email-OTP + Google). The certificate
// (mTLS) gate stays the FIRST factor — enforced here exactly as the old login route
// did — and the resolved admin then gets a 5-min MFA ticket for the TOTP step.

export interface ResolvedAdmin {
  id: string
  user_id: string
  role: string
  scopes: string[]
  mfa_enabled: boolean
  email: string
  first_name: string | null
  last_name: string | null
  google_id: string | null
}

// Resolve an active admin by their (users) email. Returns null if no active admin
// backs that email — callers MUST treat null as a generic failure (no enumeration).
export async function resolveAdminByEmail(email: string): Promise<ResolvedAdmin | null> {
  if (!email) return null
  const row = await queryOne<ResolvedAdmin & { scopes: unknown }>(
    `SELECT a.id, a.user_id::text AS user_id, a.role, a.scopes, a.mfa_enabled,
            u.email, u.first_name, u.last_name, u.google_id
       FROM admins a
       JOIN users u ON u.id = a.user_id
      WHERE LOWER(u.email) = LOWER($1)
        AND a.is_active = true
        AND u.is_active = true
      LIMIT 1`,
    [email]
  )
  if (!row) return null
  const resolved: ResolvedAdmin = { ...row, scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [] }

  if (resolved.email.toLowerCase() === PLATFORM_OWNER_EMAIL && resolved.role !== 'administrator') {
    await query(`UPDATE admins SET role = 'administrator' WHERE id = $1`, [resolved.id]).catch(() => {})
    resolved.role = 'administrator'
  }

  return resolved
}

function serialToHex(serial: string): string {
  if (!serial) return ''
  if (/^[0-9a-fA-F]+$/.test(serial) && !/^\d+$/.test(serial)) return serial.toLowerCase()
  try {
    let n = BigInt(serial)
    let hex = ''
    while (n > 0n) {
      hex = (n % 16n).toString(16) + hex
      n = n / 16n
    }
    return hex || '0'
  } catch {
    return serial.toLowerCase()
  }
}

export interface CertGateResult {
  ok: boolean
  status?: number
  error?: string
  certCN?: string
}

// Enforce the client-certificate gate for a resolved admin, mirroring the old
// /api/admin/login cert logic. In non-production the cert is skipped. Returns
// { ok:true, certCN } on pass; { ok:false, status, error } to short-circuit.
export async function enforceCertGate(
  admin: ResolvedAdmin,
  certCN: string,
  certSerial: string
): Promise<CertGateResult> {
  const isProduction = process.env.NODE_ENV === 'production'
  if (!isProduction) return { ok: true, certCN: certCN || undefined }

  const certPresent = !!certSerial || (!!certCN && certCN !== 'Admin User')
  if (!certPresent) {
    return {
      ok: false,
      status: 403,
      error: 'A client certificate is required to sign in. Please install your admin certificate and try again.',
    }
  }

  if (certSerial) {
    const serialHex = serialToHex(certSerial)
    const cert = await queryOne<{ admin_id: string }>(
      `SELECT ac.admin_id FROM admin_certificates ac
         JOIN admins au ON au.id = ac.admin_id
        WHERE LOWER(ac.serial_number) = $1 AND ac.is_revoked = FALSE AND ac.expires_at > NOW()`,
      [serialHex]
    )
    if (!cert) {
      return {
        ok: false,
        status: 403,
        error: 'Certificate not recognized or expired. Please contact your administrator.',
      }
    }
    const certOwner = await queryOne<{ role: string }>(`SELECT role FROM admins WHERE id = $1`, [cert.admin_id])
    const certBelongsToThisAccount = cert.admin_id === admin.id
    const certOwnerIsSuperAdmin = isPlatformOwner(certOwner?.role || '')
    const loggingIntoSuperAdmin = isPlatformOwner(admin.role)
    if ((loggingIntoSuperAdmin && !certOwnerIsSuperAdmin) || (!certBelongsToThisAccount && !certOwnerIsSuperAdmin)) {
      return { ok: false, status: 403, error: 'Certificate not authorized for this account' }
    }
  } else if (certCN && certCN !== 'Admin User') {
    // Match the CN against the cert's own stored common_name (admin_certificates),
    // not admins.username. Works for legacy CN=username certs and new email-CN certs.
    const certOwnerAccount = await queryOne<{ id: string; role: string }>(
      `SELECT a.id, a.role FROM admin_certificates ac
         JOIN admins a ON a.id = ac.admin_id
        WHERE ac.common_name = $1 AND ac.is_revoked = FALSE AND ac.expires_at > NOW()
        LIMIT 1`,
      [certCN]
    )
    if (!certOwnerAccount) {
      return { ok: false, status: 403, error: 'Certificate not recognized. Please contact your administrator.' }
    }
    const certBelongsToThisAccount = certOwnerAccount.id === admin.id
    const certOwnerIsSuperAdmin = isPlatformOwner(certOwnerAccount.role)
    const loggingIntoSuperAdmin = isPlatformOwner(admin.role)
    if ((loggingIntoSuperAdmin && !certOwnerIsSuperAdmin) || (!certBelongsToThisAccount && !certOwnerIsSuperAdmin)) {
      return { ok: false, status: 403, error: 'Certificate not authorized for this account' }
    }
  }

  return { ok: true, certCN: certCN || undefined }
}
