import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const query = vi.fn()
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))

import { GET, POST, PATCH } from '@controller/app/api/(admin)/admin/ecom/ai-pricing/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const ID = '33333333-3333-3333-3333-333333333333'
const row = { id: ID, capability: 'image', provider: 'razer', model: '*', unit_type: 'image', cost_inr: 0.3, price_inr: 2, active: true }
const url = 'http://localhost/api/admin/ecom/ai-pricing'
const get = () => new NextRequest(url)
const send = (method: string, body: unknown) => new NextRequest(url, { method, body: JSON.stringify(body) })

describe('/api/admin/ecom/ai-pricing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a', role: 'administrator', scopes: [] } as any)
    vi.mocked(isPlatformAdmin).mockReturnValue(true)
    query.mockResolvedValue({ rows: [row], rowCount: 1 })
  })

  it('lists rows on ecom_billing:read', async () => {
    const j = await (await GET(get())).json()
    expect(j.rows).toEqual([row])
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_billing:read')
  })

  it('refuses a non-platform admin', async () => {
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await GET(get())).status).toBe(403)
    expect((await PATCH(send('PATCH', { id: ID, price_inr: 3 }))).status).toBe(403)
    expect(query).not.toHaveBeenCalled()
  })

  it('needs ecom_billing:write to change prices', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await POST(send('POST', row))).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_billing:write')
  })

  it('adds a row and reports a duplicate', async () => {
    const res = await POST(send('POST', { capability: 'image', provider: 'Razer', model: '*', unit_type: 'image', cost_inr: 0.3, price_inr: 2 }))
    expect(res.status).toBe(201)
    expect(query.mock.calls[0][1]).toEqual(['image', 'razer', '*', 'image', 0.3, 2, true])
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    expect((await POST(send('POST', { capability: 'image', provider: 'razer', unit_type: 'image' }))).status).toBe(409)
  })

  it('validates input', async () => {
    expect((await POST(send('POST', { capability: 'music', provider: 'x', unit_type: 'image' }))).status).toBe(400)
    expect((await PATCH(send('PATCH', { id: ID, price_inr: -1 }))).status).toBe(400)
    expect((await PATCH(send('PATCH', { id: ID }))).status).toBe(400)
    expect((await PATCH(send('PATCH', { id: 'nope', price_inr: 1 }))).status).toBe(400)
  })

  it('updates price, cost and active', async () => {
    const res = await PATCH(send('PATCH', { id: ID, price_inr: 2.5, cost_inr: 0.4, active: false }))
    expect(res.status).toBe(200)
    expect(query.mock.calls[0][0]).toContain('cost_inr = $2, price_inr = $3, active = $4')
    expect(query.mock.calls[0][1]).toEqual([ID, 0.4, 2.5, false])
  })

  it('404s an unknown id', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    expect((await PATCH(send('PATCH', { id: ID, price_inr: 1 }))).status).toBe(404)
  })
})
