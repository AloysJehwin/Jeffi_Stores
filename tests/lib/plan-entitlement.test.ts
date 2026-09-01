import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetTenantPlan, mockQueryOne } = vi.hoisted(() => ({
  mockGetTenantPlan: vi.fn(),
  mockQueryOne: vi.fn(),
}))

vi.mock('@/lib/plan-gate', () => ({ getTenantPlan: mockGetTenantPlan }))
vi.mock('@/lib/db', () => ({ query: vi.fn(), queryOne: mockQueryOne, queryMany: vi.fn() }))

import { resolveSession } from '@/lib/auth-sessions'
import crypto from 'crypto'

const TOKEN = crypto.randomBytes(32).toString('hex')
const GRANTED = ['dashboard:read', 'settings:read', 'products:read', 'products:write', 'invoices:read', 'labels:read']
const BASIC = new Set(['products:read', 'products:write'])

function row(tenantId: string | null) {
  return {
    id: 'sess-1', principal_type: 'admin', principal_id: 'a-1',
    revoked_at: null,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    last_seen_at: new Date().toISOString(),
    role: 'super_admin', scopes: GRANTED, cert_cn: null, approval_status: null,
    tenant_id: tenantId,
    user_agent: null, accept_lang: null, ua_platform: null, ip_net: null, fp_hash: null,
    email: 'owner@acme.test', first_name: 'Acme', last_name: 'Owner',
  }
}

describe('a session carries the plan entitlement, not the raw grant', () => {
  beforeEach(() => {
    mockQueryOne.mockReset()
    mockGetTenantPlan.mockReset()
  })

  it('narrows a tenant session to the scopes its plan sells', async () => {
    mockQueryOne.mockResolvedValue(row('t-1'))
    mockGetTenantPlan.mockResolvedValue({ plan: 'basic', scopes: BASIC })
    const s = await resolveSession(TOKEN)
    expect(s!.scopes.sort()).toEqual(['products:read', 'products:write'])
  })

  it('leaves a platform session untouched', async () => {
    mockQueryOne.mockResolvedValue(row(null))
    const s = await resolveSession(TOKEN)
    expect(s!.scopes.sort()).toEqual([...GRANTED].sort())
    expect(mockGetTenantPlan).not.toHaveBeenCalled()
  })

  it('fails closed to the safe core when the control plane cannot be reached', async () => {
    mockQueryOne.mockResolvedValue(row('t-1'))
    mockGetTenantPlan.mockRejectedValue(new Error('control plane unreachable'))
    const s = await resolveSession(TOKEN)
    expect(s!.scopes.sort()).toEqual(['dashboard:read', 'settings:read'])
  })

  it('fails closed to the safe core on an empty plan rather than over-granting', async () => {
    mockQueryOne.mockResolvedValue(row('t-1'))
    mockGetTenantPlan.mockResolvedValue({ plan: 'basic', scopes: new Set() })
    const s = await resolveSession(TOKEN)
    expect(s!.scopes.sort()).toEqual(['dashboard:read', 'settings:read'])
  })
})
