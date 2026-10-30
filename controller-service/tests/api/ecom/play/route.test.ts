import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockQuery, mockFetchService, mockApprovals } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockFetchService: vi.fn(),
  mockApprovals: vi.fn(),
}))

const TENANT = { id: 't-1', slug: 'acme', service_types: ['messaging', 'documents'] }
vi.mock('@controller/lib/ecom/owner-api', () => ({ ownerApi: async () => ({ owner: { id: 'o-1' }, tenant: TENANT, tenants: [TENANT] }) }))
vi.mock('@/lib/tenant-registry/shared', () => ({ controlPlanePool: () => ({ query: mockQuery }) }))
vi.mock('@/lib/tenant-registry', () => ({
  hasService: (t: { service_types: string[] }, s: string) => t.service_types.includes(s),
  listServiceApprovals: mockApprovals,
  blockedServices: (rows: Array<{ service: string; status: string }>) => new Map(rows.filter(r => r.status !== 'approved').map(r => [r.service, r.status])),
}))
vi.mock('@/lib/ecom/service-client', () => ({ fetchService: mockFetchService }))

import { POST } from '@controller/app/api/(ecom)/ecom/play/route'

const KEY = '11111111-1111-4111-8111-111111111111'
const MSG = { apiKeyId: KEY, kind: 'message', channel: 'whatsapp', template: 'order/confirmed', to: '+919876543210', variables: { 1: 'Priya' } }
const req = (body: unknown) => new NextRequest('https://ecom.jeffistores.in/api/ecom/play', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe('POST /api/ecom/play', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApprovals.mockResolvedValue([])
    mockQuery.mockResolvedValue({ rows: [{ id: KEY, scopes: ['messages:send'] }] })
  })

  it('404s a key that is foreign or revoked', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const res = await POST(req(MSG))
    expect(res.status).toBe(404)
    expect(mockQuery.mock.calls[0][1]).toEqual([KEY, 't-1'])
    expect(mockQuery.mock.calls[0][0]).toContain("status = 'active'")
    expect(mockFetchService).not.toHaveBeenCalled()
  })

  it('403s a key without the scope', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: KEY, scopes: ['templates:read'] }] })
    expect((await POST(req(MSG))).status).toBe(403)
    expect(mockFetchService).not.toHaveBeenCalled()
  })

  it('403s while the service awaits approval', async () => {
    mockApprovals.mockResolvedValue([{ service: 'messaging', status: 'pending' }])
    const res = await POST(req(MSG))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('service_pending_approval')
  })

  it('sends on behalf of the key and returns the service response', async () => {
    mockFetchService.mockResolvedValue(new Response(JSON.stringify({ id: 'm-1', status: 'queued' }), { status: 202, headers: { 'content-type': 'application/json' } }))
    const res = await POST(req(MSG))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ id: 'm-1', status: 'queued' })
    const [service, tenant, path, init] = mockFetchService.mock.calls[0]
    expect([service, tenant.id, path]).toEqual(['messaging', 't-1', '/messages'])
    expect(init).toMatchObject({ method: 'POST', apiKeyId: KEY, internal: false, space: 'api' })
    expect(init.body).toMatchObject({ channel: 'whatsapp', template: 'order/confirmed', to: '+919876543210' })
    expect(init.body).not.toHaveProperty('apiKeyId')
    expect(init.body).not.toHaveProperty('kind')
    expect(mockQuery.mock.calls.at(-1)![0]).toContain('last_used_at = now()')
  })
})
