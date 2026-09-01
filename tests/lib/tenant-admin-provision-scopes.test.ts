import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockQuery, mockQueryOne, mockGetTenantPlan, mockPool } = vi.hoisted(() => ({
  mockQuery: vi.fn().mockResolvedValue({ rows: [] }),
  mockQueryOne: vi.fn(),
  mockGetTenantPlan: vi.fn(),
  mockPool: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ query: mockQuery, queryOne: mockQueryOne }))
vi.mock('@/lib/plan-gate', () => ({ getTenantPlan: mockGetTenantPlan }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: mockPool }) }))
vi.mock('@/lib/tenant-ca', () => ({
  issueTenantAdminCert: vi.fn().mockResolvedValue({
    serial: 'AB', p12Buffer: Buffer.from(''), p12Password: 'x', expiresAt: new Date(),
  }),
}))
vi.mock('@/lib/email', () => ({ sendAdminCertificateEmail: vi.fn() }))

import { provisionTenantOwnerAdmin } from '@/lib/tenant-admin-provision'
import { TENANT_SCOPE_KEYS } from '@/lib/scopes'

const BASIC = new Set(['products:read', 'products:write', 'orders:read', 'dashboard:read'])

function grantedScopes(): string[] {
  // The admins INSERT is the second queryOne call; its scopes param is JSON.
  const call = mockQueryOne.mock.calls.find(c => String(c[0]).includes('INSERT INTO admins'))
  return JSON.parse(call![1][1])
}

describe('an owner is provisioned with the scopes their plan sells', () => {
  beforeEach(() => {
    mockQueryOne.mockReset()
    mockQueryOne.mockResolvedValue({ id: 'row-1' })
    mockQueryOne.mockResolvedValueOnce(null)          // no existing super_admin
    mockGetTenantPlan.mockReset()
    mockPool.mockReset()
    mockPool.mockResolvedValue({ rows: [{
      id: 't-1', slug: 'acme', display_name: 'Acme', plan: 'basic',
      rds_endpoint: 'ep', rds_db: 'jeffi_stores', rds_port: 5432, iam_auth: true,
      s3_bucket: 'b', region: 'us-east-1',
    }] })
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
