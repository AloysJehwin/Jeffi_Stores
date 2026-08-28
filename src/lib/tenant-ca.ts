import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { controlPlanePool } from './tenant-registry'

/**
 * Per-tenant certificate authority for tenant admin mTLS.
 *
 * Each tenant gets its own CA, so a client certificate issued for tenant A can never
 * authenticate against tenant B — the isolation is cryptographic, not a policy check.
 *
 * nginx cannot select a CA file from a variable, so a regex server_name block physically
 * cannot do per-tenant `ssl_client_certificate`. Instead nginx runs `optional_no_ca` and
 * forwards the raw client cert; verification happens here against the tenant's own CA.
 * That keeps CA rotation and tenant onboarding entirely dynamic — no nginx server block
 * per tenant, and no reload.
 */

const ALGO = 'aes-256-gcm'
const PREFIX = 'v1'
const CA_DAYS = 3650
const CLIENT_DAYS = 365

function loadKey(): Buffer {
  const raw = process.env.TENANT_CA_ENC_KEY || process.env.SOCIAL_TOKEN_ENC_KEY
  if (!raw || !raw.trim()) {
    throw new Error('TENANT_CA_ENC_KEY is not set — required to encrypt tenant CA signing keys at rest')
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

function decrypt(encoded: string): string {
  const [v, iv, tag, ct] = encoded.split(':')
  if (v !== PREFIX) throw new Error('tenant CA key: unrecognised cipher version')
  const d = crypto.createDecipheriv(ALGO, loadKey(), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8')
}

export interface TenantCa { caCertPem: string; caKeyPem: string; subject: string; expiresAt: Date }

function caSubject(slug: string): string {
  return `/C=IN/O=Jeffi Commerce/OU=Tenant Admin CA/CN=${slug}.admin-ca`
}

/** Create the tenant's CA if it does not exist yet. Idempotent. */
export async function ensureTenantCa(tenantId: string, slug: string): Promise<TenantCa> {
  const existing = await getTenantCa(tenantId)
  if (existing) return existing

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-ca-'))
  const keyPath = path.join(tmp, 'ca-key.pem')
  const certPath = path.join(tmp, 'ca-cert.pem')
  try {
    execFileSync('openssl', ['genrsa', '-out', keyPath, '4096'], { stdio: 'pipe' })
    execFileSync('openssl', [
      'req', '-x509', '-new', '-nodes', '-key', keyPath,
      '-sha256', '-days', String(CA_DAYS), '-out', certPath, '-subj', caSubject(slug),
    ], { stdio: 'pipe' })

    const caCertPem = fs.readFileSync(certPath, 'utf8')
    const caKeyPem = fs.readFileSync(keyPath, 'utf8')
    const expiresAt = new Date(Date.now() + CA_DAYS * 86400_000)

    await controlPlanePool().query(
      `INSERT INTO tenant_ca (tenant_id, ca_cert_pem, ca_key_pem, subject, expires_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId, caCertPem, encrypt(caKeyPem), caSubject(slug), expiresAt],
    )
    return { caCertPem, caKeyPem, subject: caSubject(slug), expiresAt }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

export async function getTenantCa(tenantId: string): Promise<TenantCa | null> {
  const r = await controlPlanePool().query(
    'SELECT ca_cert_pem, ca_key_pem, subject, expires_at FROM tenant_ca WHERE tenant_id = $1', [tenantId])
  const row = r.rows[0]
  if (!row) return null
  return {
    caCertPem: row.ca_cert_pem,
    caKeyPem: decrypt(row.ca_key_pem),
    subject: row.subject,
    expiresAt: new Date(row.expires_at),
  }
}

/** Public CA cert only — the hot path for verifying an inbound client certificate. */
export async function getTenantCaCert(tenantId: string): Promise<string | null> {
  const r = await controlPlanePool().query(
    'SELECT ca_cert_pem FROM tenant_ca WHERE tenant_id = $1', [tenantId])
  return r.rows[0]?.ca_cert_pem ?? null
}

export interface IssuedCert {
  p12Buffer: Buffer
  p12Password: string
  serial: string
  commonName: string
  expiresAt: Date
}

/** Issue a client certificate signed by the tenant's own CA and record it for revocation. */
export async function issueTenantAdminCert(opts: {
  tenantId: string
  slug: string
  commonName: string
  issuedTo: string
}): Promise<IssuedCert> {
  if (!/^[a-zA-Z0-9._@-]{1,64}$/.test(opts.commonName)) {
    throw new Error('Invalid common name for certificate generation')
  }
  const ca = await ensureTenantCa(opts.tenantId, opts.slug)

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-cert-'))
  const caKeyPath = path.join(tmp, 'ca-key.pem')
  const caCertPath = path.join(tmp, 'ca-cert.pem')
  const keyPath = path.join(tmp, 'client-key.pem')
  const csrPath = path.join(tmp, 'client.csr')
  const certPath = path.join(tmp, 'client-cert.pem')
  const extPath = path.join(tmp, 'ext.cnf')
  const p12Path = path.join(tmp, 'client.p12')

  const serialHex = crypto.randomBytes(16).toString('hex')
  const p12Password = crypto.randomBytes(9).toString('base64url')

  try {
    fs.writeFileSync(caKeyPath, ca.caKeyPem, { mode: 0o600 })
    fs.writeFileSync(caCertPath, ca.caCertPem)
    execFileSync('openssl', ['genrsa', '-out', keyPath, '4096'], { stdio: 'pipe' })

    // The tenant slug is carried in OU so a mis-routed cert is visibly wrong, and the app
    // additionally binds on the CA itself.
    const subject = `/C=IN/O=Jeffi Commerce/OU=${opts.slug}/CN=${opts.commonName}`
    execFileSync('openssl', ['req', '-new', '-key', keyPath, '-out', csrPath, '-subj', subject], { stdio: 'pipe' })

    fs.writeFileSync(extPath, [
      'basicConstraints = CA:FALSE',
      'keyUsage = digitalSignature, keyEncipherment',
      'extendedKeyUsage = clientAuth',
      'subjectKeyIdentifier = hash',
      'authorityKeyIdentifier = keyid,issuer',
    ].join('\n'))

    execFileSync('openssl', [
      'x509', '-req', '-days', String(CLIENT_DAYS), '-in', csrPath,
      '-CA', caCertPath, '-CAkey', caKeyPath,
      '-out', certPath, '-extfile', extPath, '-set_serial', `0x${serialHex}`, '-sha256',
    ], { stdio: 'pipe' })

    execFileSync('openssl', [
      'pkcs12', '-export', '-out', p12Path,
      '-inkey', keyPath, '-in', certPath, '-certfile', caCertPath,
      '-name', `${opts.slug}-admin-cert`, '-passout', `pass:${p12Password}`,
    ], { stdio: 'pipe' })

    const p12Buffer = fs.readFileSync(p12Path)
    const serial = serialHex.toUpperCase()
    const expiresAt = new Date(Date.now() + CLIENT_DAYS * 86400_000)

    await controlPlanePool().query(
      `INSERT INTO tenant_admin_certs (tenant_id, serial, common_name, issued_to, expires_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (serial) DO NOTHING`,
      [opts.tenantId, serial, opts.commonName, opts.issuedTo, expiresAt],
    )

    return { p12Buffer, p12Password, serial, commonName: opts.commonName, expiresAt }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

export async function revokeTenantAdminCert(serial: string, revokedBy: string): Promise<boolean> {
  const r = await controlPlanePool().query(
    `UPDATE tenant_admin_certs SET revoked_at = now(), revoked_by = $2
     WHERE serial = $1 AND revoked_at IS NULL`,
    [serial.toUpperCase(), revokedBy],
  )
  return (r.rowCount ?? 0) > 0
}

export interface AdminCertRow {
  id: string
  serial: string
  common_name: string
  issued_to: string | null
  issued_at: string
  expires_at: string
  revoked_at: string | null
  revoked_by: string | null
}

export async function listTenantAdminCerts(tenantId: string): Promise<AdminCertRow[]> {
  const r = await controlPlanePool().query(
    `SELECT id, serial, common_name, issued_to, issued_at, expires_at, revoked_at, revoked_by
     FROM tenant_admin_certs WHERE tenant_id = $1 ORDER BY issued_at DESC`, [tenantId])
  return r.rows as AdminCertRow[]
}
