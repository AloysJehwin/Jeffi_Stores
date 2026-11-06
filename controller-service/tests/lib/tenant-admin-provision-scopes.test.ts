import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockQuery, mockQueryOne, mockGetTenantPlan, mockPool, ca, mail, portal } = vi.hoisted(() => ({
  mockQuery: vi.fn().mockResolvedValue({ rows: [] }),
  mockQueryOne: vi.fn(),
  mockGetTenantPlan: vi.fn(),
  mockPool: vi.fn(),
  ca: {
    issueTenantAdminCert: vi.fn(),
    getTenantCa: vi.fn(),
    revokeTenantAdminCert: vi.fn(),
  },
  mail: { sendAdminCertificateEmail: vi.fn(), sendCertInviteEmail: vi.fn() },
  portal: { recordPortalCert: vi.fn(), revokePortalCerts: vi.fn() },
}))

vi.mock('@/lib/shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }))
vi.mock('@/lib/auth/plan-gate', () => ({ getTenantPlan: mockGetTenantPlan }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: mockPool }) }))
vi.mock('@/lib/tenancy/tenant-ca', () => ca)
vi.mock('@/lib/email', () => mail)
vi.mock('@/lib/tenancy/portal-certs', () => portal)

function resetCertMocks() {
  ca.issueTenantAdminCert.mockReset().mockResolvedValue({ serial: 'AB', p12Buffer: Buffer.from(''), p12Password: 'x', expiresAt: new Date() })
  ca.getTenantCa.mockReset().mockResolvedValue({ subject: 'CN=acme' })
  ca.revokeTenantAdminCert.mockReset().mockResolvedValue(true)
  mail.sendAdminCertificateEmail.mockReset().mockResolvedValue(undefined)
  mail.sendCertInviteEmail.mockReset().mockResolvedValue(undefined)
  portal.recordPortalCert.mockReset().mockResolvedValue(undefined)
  portal.revokePortalCerts.mockReset().mockResolvedValue(undefined)
}

import { provisionTenantOwnerAdmin } from '@controller/lib/tenancy/tenant-admin-provision'
import { TENANT_SCOPE_KEYS } from '@/lib/auth/scopes'

const BASIC = new Set(['products:read', 'products:write', 'orders:read', 'dashboard:read'])

function grantedScopes(): string[] {
  // The admins INSERT is the second queryOne call; its scopes param is JSON.
  const call = mockQueryOne.mock.calls.find(c => String(c[0]).includes('INSERT INTO admins'))
  return JSON.parse(call![1][1])
}

describe('an owner is provisioned with the scopes their plan sells', () => {
  beforeEach(() => {
    resetCertMocks()
    mockQueryOne.mockReset()
    mockQueryOne.mockResolvedValue({ id: 'row-1' })
    mockQueryOne.mockResolvedValueOnce(null) // no existing super_admin
    mockGetTenantPlan.mockReset()
    mockPool.mockReset()
    mockPool.mockResolvedValue({
      rows: [
        {
          id: 't-1',
          slug: 'acme',
          display_name: 'Acme',
          plan: 'basic',
          rds_endpoint: 'ep',
          rds_db: 'jeffi_stores',
          rds_port: 5432,
          iam_auth: true,
          s3_bucket: 'b',
          region: 'us-east-1',
        },
      ],
    })
  })

  const opts = { tenantId: 't-1', tenantSlug: 'acme', ownerEmail: 'o@acme.test', ownerName: 'Owner' }

  it('grants only the plan scopes, not every tenant scope', async () => {
    mockGetTenantPlan.mockResolvedValue({ plan: 'basic', scopes: BASIC })
    await provisionTenantOwnerAdmin(opts)
    const granted = grantedScopes()
    expect(granted.sort()).toEqual([...BASIC].sort())
    expect(granted.length).toBeLessThan(TENANT_SCOPE_KEYS.length)
  })

  it('never grants a control-plane scope', async () => {
    mockGetTenantPlan.mockResolvedValue({ plan: 'basic', scopes: new Set([...BASIC, 'ecom_billing:write']) })
    await provisionTenantOwnerAdmin(opts)
    expect(grantedScopes()).not.toContain('ecom_billing:write')
  })

  it('falls open to the full tenant set when the plan cannot be read', async () => {
    mockGetTenantPlan.mockRejectedValue(new Error('control plane down'))
    await provisionTenantOwnerAdmin(opts)
    expect(grantedScopes()).toEqual(TENANT_SCOPE_KEYS)
  })
})

describe('a not-yet-ready tenant RDS self-heals', () => {
  beforeEach(() => {
    resetCertMocks()
    mockQueryOne.mockReset()
    mockGetTenantPlan.mockReset()
    mockGetTenantPlan.mockResolvedValue({ plan: 'basic', scopes: BASIC })
    mockPool.mockReset()
    mockPool.mockResolvedValue({
      rows: [
        {
          id: 't-1',
          slug: 'acme',
          display_name: 'Acme',
          plan: 'basic',
          rds_endpoint: 'ep',
          rds_db: 'jeffi_stores',
          rds_port: 5432,
          iam_auth: true,
          s3_bucket: 'b',
          region: 'us-east-1',
        },
      ],
    })
  })

  const opts = { tenantId: 't-1', tenantSlug: 'acme', ownerEmail: 'o@acme.test', ownerName: 'Owner' }

  it('retries a transient connection timeout and then succeeds', async () => {
    let attempt = 0
    mockQueryOne.mockImplementation(async () => {
      // The existing-cert check is the first queryOne of each attempt; fail the connect twice.
      if (++attempt <= 2) throw new Error('Connection terminated due to connection timeout')
      return { id: 'row-1' }
    })
    const res = await provisionTenantOwnerAdmin(opts)
    expect(res.success).toBe(true)
    expect(attempt).toBeGreaterThan(2)
  }, 20_000)

  it('does NOT retry a non-transient error — fails on the first attempt', async () => {
    let attempt = 0
    mockQueryOne.mockImplementation(async () => {
      attempt++
      throw new Error('invalid input syntax for type json')
    })
    const res = await provisionTenantOwnerAdmin(opts)
    expect(res.success).toBe(false)
    expect(attempt).toBe(1)
  })
})

describe('owner certificate: idempotency, re-issue and revocation', () => {
  const TENANT_ROW = { id: 't-1', slug: 'acme', display_name: 'Acme', plan: 'basic', rds_endpoint: 'ep', rds_db: 'jeffi_stores', rds_port: 5432, iam_auth: true, s3_bucket: 'b', region: 'us-east-1' }
  const opts = { tenantId: 't-1', tenantSlug: 'acme', ownerEmail: 'o@acme.test', ownerName: 'Owner' }
  /** `active`: the owner's unrevoked, unexpired certificates, newest first. */
  function db(active: string[]) {
    mockQueryOne.mockReset().mockImplementation(async (sql: string) =>
      sql.includes('FROM admin_certificates') ? (active[0] ? { id: 'c-1', serial_number: active[0] } : null) : { id: 'row-1' }
    )
    mockQuery.mockReset().mockImplementation(async (sql: string) =>
      sql.includes('FROM admin_certificates') ? { rows: active.map(serial_number => ({ serial_number })) } : { rows: [] }
    )
  }

  beforeEach(() => {
    resetCertMocks()
    mockGetTenantPlan.mockReset().mockResolvedValue({ plan: 'basic', scopes: BASIC })
    mockPool.mockReset().mockResolvedValue({ rows: [TENANT_ROW] })
  })

  it('an active certificate means exists: nothing issued, nothing emailed', async () => {
    db(['OLD1'])
    const r = await provisionTenantOwnerAdmin(opts)
    expect(r).toMatchObject({ success: true, outcome: 'exists', serial: 'OLD1', emailed: false })
    expect(ca.issueTenantAdminCert).not.toHaveBeenCalled()
    expect(mail.sendCertInviteEmail).not.toHaveBeenCalled()
  })

  it('counts only unrevoked, unexpired certificates as active', async () => {
    db([])
    const r = await provisionTenantOwnerAdmin(opts)
    expect(r).toMatchObject({ success: true, outcome: 'issued', serial: 'AB', emailed: true })
    const check = String(mockQueryOne.mock.calls.find(c => String(c[0]).includes('FROM admin_certificates'))![0])
    expect(check).toMatch(/is_revoked IS NOT TRUE/)
    expect(check).toMatch(/expires_at > now\(\)/)
  })

  it('force re-issues; revokeExisting revokes the old serials everywhere, never the new one', async () => {
    db(['OLD1', 'OLD2'])
    const r = await provisionTenantOwnerAdmin({ ...opts, force: true, revokeExisting: true, revokedBy: 'ops@jeffi.test' })
    expect(r).toMatchObject({ success: true, outcome: 'reissued', serial: 'AB', revoked: ['OLD1', 'OLD2'] })
    expect(ca.revokeTenantAdminCert).toHaveBeenCalledWith('OLD1', 'ops@jeffi.test')
    expect(ca.revokeTenantAdminCert).toHaveBeenCalledWith('OLD2', 'ops@jeffi.test')
    expect(ca.revokeTenantAdminCert).not.toHaveBeenCalledWith('AB', expect.anything())
    expect(portal.revokePortalCerts).toHaveBeenCalledWith(['OLD1', 'OLD2'])
    const update = mockQuery.mock.calls.find(c => String(c[0]).includes('UPDATE admin_certificates'))
    expect(update?.[1]).toEqual([['OLD1', 'OLD2']])
  })

  it('force without revokeExisting leaves the old certificates alone', async () => {
    db(['OLD1'])
    const r = await provisionTenantOwnerAdmin({ ...opts, force: true })
    expect(r).toMatchObject({ outcome: 'reissued', revoked: [] })
    expect(ca.revokeTenantAdminCert).not.toHaveBeenCalled()
  })

  it('a failed email still issues the certificate (emailed: false), and a later call resends the invite', async () => {
    db([])
    mail.sendAdminCertificateEmail.mockRejectedValue(new Error('SES throttled'))
    const first = await provisionTenantOwnerAdmin(opts)
    expect(first).toMatchObject({ success: true, outcome: 'issued', serial: 'AB', emailed: false })

    db(['AB'])
    const again = await provisionTenantOwnerAdmin({ ...opts, resendInviteFor: 'ab' })
    expect(again).toMatchObject({ outcome: 'exists', emailed: true })
    expect(mail.sendCertInviteEmail).toHaveBeenCalledTimes(1)
    expect(ca.issueTenantAdminCert).toHaveBeenCalledTimes(1)
  })

  it('reports caCreated when the tenant had no CA before this certificate', async () => {
    db([])
    ca.getTenantCa.mockResolvedValue(null)
    expect(await provisionTenantOwnerAdmin(opts)).toMatchObject({ outcome: 'issued', caCreated: true })
  })
})
