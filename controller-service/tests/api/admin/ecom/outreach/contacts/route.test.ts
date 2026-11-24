import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ listContacts: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@controller/lib/outreach/contacts', () => ({ listContacts: m.listContacts }))

import { GET } from '@controller/app/api/(admin)/admin/ecom/outreach/contacts/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const get = (qs = '') => GET(new NextRequest('http://localhost/api/admin/ecom/outreach/contacts' + qs))
const LIST = '33333333-3333-3333-3333-333333333333'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] } as any)
  vi.mocked(isPlatformAdmin).mockReturnValue(true)
  m.listContacts.mockResolvedValue({ rows: [{ id: 'c1' }], total: 1, page: 1, pageSize: 50 })
})

describe('/api/admin/ecom/outreach/contacts', () => {
  it('401 / 403 gates', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await get()).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await get()).status).toBe(403)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await get()).status).toBe(403)
    expect(m.listContacts).not.toHaveBeenCalled()
  })

  it('400 on an unknown status, a bad list id or a bad page', async () => {
    expect((await get('?status=queued,bogus')).status).toBe(400)
    expect((await get('?list=nope')).status).toBe(400)
    expect((await get('?page=0')).status).toBe(400)
  })

  it('applies the status, list, query and paging filters', async () => {
    const res = await get(`?status=queued,no_answer&list=${LIST}&q=sri&page=2&pageSize=20`)
    expect((await res.json()).total).toBe(1)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:read')
    expect(m.listContacts).toHaveBeenCalledWith({ program: 'showcase-offer', statuses: ['queued', 'no_answer'], listId: LIST, q: 'sri', page: 2, pageSize: 20 })
  })
})
