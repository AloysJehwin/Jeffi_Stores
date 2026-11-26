import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { mockOwnerApi, mockApprovals, mockEnrich } = vi.hoisted(() => ({
  mockOwnerApi: vi.fn(),
  mockApprovals: vi.fn(),
  mockEnrich: vi.fn(),
}))

vi.mock('@controller/lib/ecom/owner-api', () => ({ ownerApi: mockOwnerApi }))
vi.mock('@/lib/tenant-registry', () => ({
  hasService: (t: { service_types: string[] }, s: string) => t.service_types.includes(s),
  listServiceApprovals: mockApprovals,
  blockedServices: (rows: Array<{ service: string; status: string }>) => new Map(rows.filter(r => r.status !== 'approved').map(r => [r.service, r.status])),
}))
vi.mock('@/lib/ai/enrich-field', () => ({ enrichField: mockEnrich, parseEnrichBody: (b: object) => b }))

import { POST } from '@controller/app/api/(ecom)/ecom/ai/enrich-field/route'
import { billedTenantId } from '@/lib/ai/billing'

const TENANT = { id: 't-1', display_name: 'Acme', service_types: ['messaging'] }
const req = (body: unknown) =>
  new NextRequest('https://ecom.jeffistores.in/api/ecom/ai/enrich-field', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe('POST /api/ecom/ai/enrich-field', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOwnerApi.mockResolvedValue({ owner: { id: 'o-1' }, tenant: TENANT, tenants: [TENANT] })
    mockApprovals.mockResolvedValue([])
  })

  it('returns the guard response when not signed in', async () => {
    mockOwnerApi.mockResolvedValue(NextResponse.json({ error: 'Not signed in' }, { status: 401 }))
    expect((await POST(req({}))).status).toBe(401)
    expect(mockEnrich).not.toHaveBeenCalled()
  })

  it('403s while messaging approval is pending', async () => {
    mockApprovals.mockResolvedValue([{ service: 'messaging', status: 'pending' }])
    expect((await POST(req({ field: 'x' }))).status).toBe(403)
    expect(mockEnrich).not.toHaveBeenCalled()
  })

  it('400s an invalid JSON body', async () => {
    expect((await POST(req('not json'))).status).toBe(400)
  })

  it('enriches the field for the store and returns the result', async () => {
    let billedDuring: string | null = null
    mockEnrich.mockImplementation(async () => {
      billedDuring = billedTenantId()
      return 'better text'
    })
    const res = await POST(req({ field: 'desc', text: 'hi' }))
    expect(billedDuring).toBe('t-1')
    expect(billedTenantId()).toBeNull()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: 'better text' })
    expect(mockEnrich).toHaveBeenCalledWith(expect.objectContaining({ store: expect.stringContaining('Acme'), field: 'desc', text: 'hi' }))
  })

  it('maps an AI error to its status', async () => {
    mockEnrich.mockRejectedValue(Object.assign(new Error('wallet empty'), { status: 402 }))
    const res = await POST(req({ field: 'desc' }))
    expect(res.status).toBe(402)
    expect((await res.json()).error).toBe('wallet empty')
  })
})
