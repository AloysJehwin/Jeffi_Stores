import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { mockOwnerApi, mockApprovals, mockFill, mockRate, billed } = vi.hoisted(() => ({
  mockOwnerApi: vi.fn(),
  mockApprovals: vi.fn(),
  mockFill: vi.fn(),
  mockRate: vi.fn(),
  billed: { tenant: null as string | null, during: null as string | null },
}))

vi.mock('@controller/lib/ecom/owner-api', () => ({ ownerApi: mockOwnerApi }))
vi.mock('@/lib/tenant-registry', () => ({
  hasService: (t: { service_types: string[] }, s: string) => t.service_types.includes(s),
  listServiceApprovals: mockApprovals,
  blockedServices: (rows: Array<{ service: string; status: string }>) => new Map(rows.filter(r => r.status !== 'approved').map(r => [r.service, r.status])),
}))
vi.mock('@/lib/ai/template-scenario', () => ({
  fillFromScenario: mockFill,
  rateLimit: mockRate,
  TemplateScenarioError: class extends Error { status = 422 },
}))
vi.mock('@/lib/ai/billing', () => ({
  AiWalletError: class extends Error { status = 402; balanceInr = 1; neededInr = 5 },
  runBilledTo: async (tenantId: string, fn: () => Promise<unknown>) => {
    billed.tenant = tenantId
    try {
      return await fn()
    } finally {
      billed.tenant = null
    }
  },
}))
vi.mock('@/lib/ai/media', () => ({ AiMediaError: class extends Error { status = 415 } }))

import { POST } from '@controller/app/api/(ecom)/ecom/ai/template-scenario/route'
import { AiWalletError } from '@/lib/ai/billing'

const TENANT = { id: 't-1', service_types: ['documents'] }
const BODY = { channel: 'whatsapp', scenarioText: 'order shipped', templateMode: 'utility', tenantContext: { storeName: 'Acme' } }
const req = (body: unknown) =>
  new NextRequest('https://ecom.jeffistores.in/api/ecom/ai/template-scenario', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe('POST /api/ecom/ai/template-scenario', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOwnerApi.mockResolvedValue({ owner: { id: 'o-1', email: 'o@acme.test' }, tenant: TENANT, tenants: [TENANT] })
    mockApprovals.mockResolvedValue([])
    mockRate.mockReturnValue(true)
  })

  it('rejects an unauthenticated caller', async () => {
    mockOwnerApi.mockResolvedValue(NextResponse.json({ error: 'Not signed in' }, { status: 401 }))
    expect((await POST(req(BODY))).status).toBe(401)
  })

  it('403s when no approved service', async () => {
    mockApprovals.mockResolvedValue([{ service: 'documents', status: 'blocked' }])
    expect((await POST(req(BODY))).status).toBe(403)
    expect(mockFill).not.toHaveBeenCalled()
  })

  it('400s an invalid body and 429s a rate-limited repeat', async () => {
    expect((await POST(req({ channel: 'fax' }))).status).toBe(400)
    mockRate.mockReturnValue(false)
    expect((await POST(req(BODY))).status).toBe(429)
    expect(mockFill).not.toHaveBeenCalled()
  })

  it('fills the scenario on the tenant wallet, never as a platform library', async () => {
    mockFill.mockImplementation(async () => {
      billed.during = billed.tenant
      return { name: 'shipped', body: 'Hi' }
    })
    const res = await POST(req({ ...BODY, isPlatformLibrary: true }))
    expect(billed.during).toBe('t-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'shipped', body: 'Hi' })
    expect(mockFill).toHaveBeenCalledWith(expect.objectContaining({ scenarioText: 'order shipped' }), 't-1', false, 'o@acme.test')
  })

  it('surfaces a wallet shortfall and a generic failure', async () => {
    mockFill.mockRejectedValueOnce(new AiWalletError('low', 1, 5))
    const res = await POST(req(BODY))
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ error: 'low', balanceInr: 1, neededInr: 5 })
    mockFill.mockRejectedValueOnce(new Error('boom'))
    expect((await POST(req(BODY))).status).toBe(502)
  })
})
