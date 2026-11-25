import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ detail: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@controller/lib/outreach/call-events', () => ({ getCallDetail: m.detail }))

import { GET } from '@controller/app/api/(admin)/admin/ecom/outreach/calls/[id]/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const ID = '11111111-1111-4111-8111-111111111111'
const get = (id = ID) => GET(new NextRequest(`http://localhost/api/admin/ecom/outreach/calls/${id}`), { params: Promise.resolve({ id }) })
const detail = {
  call: { id: ID, status: 'completed', transcript: [{ role: 'agent', text: 'Hello' }], consent: { whatsapp: true } },
  recordingUrl: 'https://signed',
  events: [{ id: 1, kind: 'call_ended' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] } as any)
  vi.mocked(isPlatformAdmin).mockReturnValue(true)
  m.detail.mockResolvedValue(detail)
})

describe('GET /api/admin/ecom/outreach/calls/[id]', () => {
  it('refuses a store admin and an unauthenticated caller', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await get()).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await get()).status).toBe(403)
    vi.mocked(requireAdminScope).mockResolvedValueOnce({ adminId: 's1', role: 'store_admin', scopes: ['ecom_outreach:read'] } as any)
    vi.mocked(isPlatformAdmin).mockReturnValueOnce(false)
    expect((await get()).status).toBe(403)
    expect(m.detail).not.toHaveBeenCalled()
  })

  it('returns { call, recordingUrl, events } under ecom_outreach:read', async () => {
    const r = await get()
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual(detail)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:read')
    expect(m.detail).toHaveBeenCalledWith(ID)
  })

  it('400 for a bad id, 404 when missing, 500 on failure', async () => {
    expect((await get('nope')).status).toBe(400)
    m.detail.mockResolvedValueOnce(null)
    expect((await get()).status).toBe(404)
    m.detail.mockRejectedValueOnce(new Error('db down'))
    expect((await get()).status).toBe(500)
  })
})
