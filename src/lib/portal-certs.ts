import crypto from 'crypto'
import { controlPlanePool } from './tenant-registry'

// Central downloadable certificate registry (portal_certs, control plane). certificate.jeffistores.in
// serves the .p12 from here, so it must be reachable without touching a tenant's private RDS. The
// blob + password are AES-256-GCM encrypted with the same scheme and key as tenant CA signing keys
// (tenant-ca.ts) — a p12 at rest in the control plane is exactly as sensitive as a CA key.

const ALGO = 'aes-256-gcm'
const PREFIX = 'v1'

function loadKey(): Buffer {
  const raw = process.env.TENANT_CA_ENC_KEY || process.env.SOCIAL_TOKEN_ENC_KEY
  if (!raw || !raw.trim()) {
    throw new Error('TENANT_CA_ENC_KEY is not set — required to encrypt portal certificates at rest')
  }
  const t = raw.trim()
  const key = /^[0-9a-fA-F]{64}$/.test(t) ? Buffer.from(t, 'hex') : Buffer.from(t, 'base64')
  if (key.length !== 32) throw new Error(`TENANT_CA_ENC_KEY must decode to 32 bytes (got ${key.length})`)
  return key
}

function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv(ALGO, loadKey(), iv)
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()])
  return [PREFIX, iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

export function decryptPortalSecret(encoded: string): string {
  const [v, iv, tag, ct] = encoded.split(':')
  if (v !== PREFIX) throw new Error('portal cert: unrecognised cipher version')
  const d = crypto.createDecipheriv(ALGO, loadKey(), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8')
}

/**
 * Mirror a revocation into the central portal registry so the portal refuses the cert. Keyed on
 * serial(s). Idempotent and non-fatal: a store-local revoke/delete must not fail because the
 * registry write did. Returns the number of rows newly revoked.
 */
export async function revokePortalCerts(serials: string[]): Promise<number> {
  const list = serials.filter(Boolean)
  if (list.length === 0) return 0
  try {
    const r = await controlPlanePool().query(
      `UPDATE portal_certs SET revoked_at = now()
        WHERE lower(serial) = ANY($1::text[]) AND revoked_at IS NULL`,
      [list.map(s => s.toLowerCase())]
    )
    return r.rowCount ?? 0
  } catch (err) {
    console.warn('[portal-certs] revokePortalCerts failed (store-local revoke still applied):', (err as Error)?.message)
    return 0
  }
}

export interface RecordPortalCertInput {
  tenantId: string | null            // null = platform admin cert
  serial: string
  commonName: string
  issuedTo: string                   // the email the portal matches on
  role: string
  storeName: string | null
  p12Buffer: Buffer
  p12Password: string
  expiresAt: Date
  downloadToken?: string
}

/**
 * Persist an issued certificate to the central portal registry. Single writer for every issuance
 * site. Idempotent on serial (a re-issue with the same serial is a no-op). Returns the download
 * token on success, or null on any failure — issuance must NOT fail because the registry write did
 * (during the transition window the cert is still emailed), so callers treat null as recoverable.
 */
export async function recordPortalCert(input: RecordPortalCertInput): Promise<string | null> {
  try {
    const downloadToken = input.downloadToken || crypto.randomUUID()
    const p12Enc = encrypt(input.p12Buffer.toString('base64'))
    const pwdEnc = encrypt(input.p12Password)
    await controlPlanePool().query(
      `INSERT INTO portal_certs
         (tenant_id, serial, common_name, issued_to, role, store_name,
          p12_data_enc, p12_password_enc, download_token, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (serial) DO NOTHING`,
      [
        input.tenantId, input.serial, input.commonName, input.issuedTo, input.role,
        input.storeName, p12Enc, pwdEnc, downloadToken, input.expiresAt,
      ]
    )
    return downloadToken
  } catch (err) {
    console.warn('[portal-certs] recordPortalCert failed (issuance continues):', (err as Error)?.message)
    return null
  }
}
