import crypto from 'crypto'
import { controlPlanePool } from './tenant-registry'
import { getTenantCaCert } from './tenant-ca'

/**
 * Verify a tenant admin client certificate.
 *
 * nginx runs `ssl_verify_client optional_no_ca` on the tenant admin hosts and forwards the
 * raw cert, because it cannot pick a per-tenant CA file from a regex server_name. All the
 * checks nginx would normally do therefore happen here, against THIS tenant's CA:
 *
 *   1. signed by the tenant's own CA (cryptographic, not a name comparison)
 *   2. within its validity window
 *   3. serial is on record for this tenant and not revoked
 *
 * A certificate issued for another tenant fails at (1): it was signed by a different CA.
 */

export type MtlsFailure =
  | 'no_certificate'
  | 'malformed'
  | 'no_tenant_ca'
  | 'untrusted_issuer'
  | 'expired'
  | 'not_yet_valid'
  | 'unknown_serial'
  | 'revoked'

export interface MtlsResult {
  ok: boolean
  reason?: MtlsFailure
  serial?: string
  commonName?: string
}

/** nginx sends $ssl_client_escaped_cert — URL-escaped PEM. */
export function decodeClientCertHeader(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim() || raw === '-') return null
  let pem = raw.trim()
  if (pem.includes('%')) {
    try { pem = decodeURIComponent(pem) } catch { return null }
  }
  pem = pem.replace(/\s*\\n\s*/g, '\n')
  return pem.includes('BEGIN CERTIFICATE') ? pem : null
}

export async function verifyTenantClientCert(certPem: string | null, tenantId: string): Promise<MtlsResult> {
  if (!certPem) return { ok: false, reason: 'no_certificate' }

  let cert: crypto.X509Certificate
  try {
    cert = new crypto.X509Certificate(certPem)
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  const caPem = await getTenantCaCert(tenantId)
  if (!caPem) return { ok: false, reason: 'no_tenant_ca' }

  let ca: crypto.X509Certificate
  try {
    ca = new crypto.X509Certificate(caPem)
  } catch {
    return { ok: false, reason: 'no_tenant_ca' }
  }

  // Signed by THIS tenant's CA. checkIssued compares issuer/authority-key; verify() proves
  // the signature — both are required, since checkIssued alone is only a name match.
  if (!cert.checkIssued(ca) || !cert.verify(ca.publicKey)) {
    return { ok: false, reason: 'untrusted_issuer' }
  }

  const now = Date.now()
  if (new Date(cert.validTo).getTime() < now) return { ok: false, reason: 'expired' }
  if (new Date(cert.validFrom).getTime() > now) return { ok: false, reason: 'not_yet_valid' }

  const serial = (cert.serialNumber || '').toUpperCase()
  const r = await controlPlanePool().query(
    'SELECT revoked_at FROM tenant_admin_certs WHERE serial = $1 AND tenant_id = $2',
    [serial, tenantId],
  )
  const row = r.rows[0]
  if (!row) return { ok: false, reason: 'unknown_serial', serial }
  if (row.revoked_at) return { ok: false, reason: 'revoked', serial }

  const cn = /CN=([^,\n/]+)/.exec(cert.subject)?.[1]?.trim()
  return { ok: true, serial, commonName: cn }
}
