import { describe, it, expect, vi, beforeAll } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'

const { mockQuery, mockGetCaCert } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGetCaCert: vi.fn(),
}))

vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: mockQuery }) }))
vi.mock('@/lib/tenant-ca', () => ({ getTenantCaCert: mockGetCaCert }))

import { verifyTenantClientCert, decodeClientCertHeader } from '@/lib/tenant-mtls'

function makeCa(slug: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-'))
  execFileSync('openssl', ['genrsa', '-out', path.join(d, 'k.pem'), '2048'], { stdio: 'pipe' })
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-new',
      '-nodes',
      '-key',
      path.join(d, 'k.pem'),
      '-sha256',
      '-days',
      '3650',
      '-out',
      path.join(d, 'c.pem'),
      '-subj',
      `/O=Jeffi/OU=Tenant Admin CA/CN=${slug}.admin-ca`,
    ],
    { stdio: 'pipe' }
  )
  return {
    dir: d,
    key: path.join(d, 'k.pem'),
    certPath: path.join(d, 'c.pem'),
    pem: fs.readFileSync(path.join(d, 'c.pem'), 'utf8'),
  }
}

function issue(ca: ReturnType<typeof makeCa>, cn: string, days = 365) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-'))
  execFileSync('openssl', ['genrsa', '-out', path.join(d, 'k.pem'), '2048'], { stdio: 'pipe' })
  execFileSync(
    'openssl',
    ['req', '-new', '-key', path.join(d, 'k.pem'), '-out', path.join(d, 'r.csr'), '-subj', `/O=Jeffi/CN=${cn}`],
    { stdio: 'pipe' }
  )
  fs.writeFileSync(
    path.join(d, 'e.cnf'),
    'basicConstraints=CA:FALSE\nextendedKeyUsage=clientAuth\nauthorityKeyIdentifier=keyid,issuer\nsubjectKeyIdentifier=hash\n'
  )
  execFileSync(
    'openssl',
    [
      'x509',
      '-req',
      '-days',
      String(days),
      '-in',
      path.join(d, 'r.csr'),
      '-CA',
      ca.certPath,
      '-CAkey',
      ca.key,
      '-CAcreateserial',
      '-out',
      path.join(d, 'c.pem'),
      '-extfile',
      path.join(d, 'e.cnf'),
      '-sha256',
    ],
    { stdio: 'pipe' }
  )
  const pem = fs.readFileSync(path.join(d, 'c.pem'), 'utf8')
  return { pem, serial: new crypto.X509Certificate(pem).serialNumber.toUpperCase() }
}

let caA: ReturnType<typeof makeCa>
let caB: ReturnType<typeof makeCa>
let certA: ReturnType<typeof issue>

beforeAll(() => {
  caA = makeCa('acme')
  caB = makeCa('bolts')
  certA = issue(caA, 'owner@acme.com')
})

function activeSerial() {
  mockQuery.mockResolvedValue({ rows: [{ revoked_at: null }] })
}

describe('verifyTenantClientCert', () => {
  it('accepts a certificate signed by the tenant own CA', async () => {
    mockGetCaCert.mockResolvedValue(caA.pem)
    activeSerial()
    const r = await verifyTenantClientCert(certA.pem, 't-acme')
    expect(r.ok).toBe(true)
    expect(r.serial).toBe(certA.serial)
    expect(r.commonName).toBe('owner@acme.com')
  })

  it('REJECTS a certificate issued by another tenant CA', async () => {
    mockGetCaCert.mockResolvedValue(caB.pem)
    activeSerial()
    const r = await verifyTenantClientCert(certA.pem, 't-bolts')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('untrusted_issuer')
  })

  it('rejects a revoked certificate', async () => {
    mockGetCaCert.mockResolvedValue(caA.pem)
    mockQuery.mockResolvedValue({ rows: [{ revoked_at: new Date() }] })
    const r = await verifyTenantClientCert(certA.pem, 't-acme')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('revoked')
  })

  it('rejects a serial not on record for the tenant', async () => {
    mockGetCaCert.mockResolvedValue(caA.pem)
    mockQuery.mockResolvedValue({ rows: [] })
    const r = await verifyTenantClientCert(certA.pem, 't-acme')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('unknown_serial')
  })

  it('rejects when the tenant has no CA', async () => {
    mockGetCaCert.mockResolvedValue(null)
    activeSerial()
    const r = await verifyTenantClientCert(certA.pem, 't-none')
    expect(r.reason).toBe('no_tenant_ca')
  })

  it('rejects a missing or malformed certificate', async () => {
    mockGetCaCert.mockResolvedValue(caA.pem)
    activeSerial()
    expect((await verifyTenantClientCert(null, 't-acme')).reason).toBe('no_certificate')
    expect(
      (await verifyTenantClientCert('-----BEGIN CERTIFICATE-----\nnope\n-----END CERTIFICATE-----', 't-acme')).reason
    ).toBe('malformed')
  })
})

describe('decodeClientCertHeader', () => {
  it('returns null for absent or placeholder values', () => {
    expect(decodeClientCertHeader(null)).toBeNull()
    expect(decodeClientCertHeader('')).toBeNull()
    expect(decodeClientCertHeader('-')).toBeNull()
    expect(decodeClientCertHeader('not a cert')).toBeNull()
  })

  it('decodes the URL-escaped PEM nginx sends', () => {
    const escaped = encodeURIComponent(certA.pem)
    const out = decodeClientCertHeader(escaped)
    expect(out).toContain('BEGIN CERTIFICATE')
    expect(() => new crypto.X509Certificate(out!)).not.toThrow()
  })
})
