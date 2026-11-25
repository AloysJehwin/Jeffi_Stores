import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ listEvents: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@controller/lib/outreach/events', () => ({ listEvents: m.listEvents }))

import { GET } from '@controller/app/api/(admin)/admin/ecom/outreach/events/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const get = (qs = '') => GET(new NextRequest('http://localhost/api/admin/ecom/outreach/events' + qs))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] } as any)
  vi.mocked(isPlatformAdmin).mockReturnValue(true)
  m.listEvents.mockResolvedValue([{ id: 2, kind: 'status_change' }])
})

describe('/api/admin/ecom/outreach/events', () => {
  it('401 / 403 gates', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await get()).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await get()).status).toBe(403)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await get()).status).toBe(403)
    expect(m.listEvents).not.toHaveBeenCalled()
  })

  it('400 on a bad contactId or limit', async () => {
    expect((await get('?contactId=nope')).status).toBe(400)
    expect((await get('?limit=9999')).status).toBe(400)
  })

  it('returns recent events under the read scope', async () => {
    expect(await (await get('?limit=20')).json()).toEqual({ events: [{ id: 2, kind: 'status_change' }] })
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:read')
    expect(m.listEvents).toHaveBeenCalledWith({ contactId: undefined, limit: 20 })
  })
})
