import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ list: vi.fn(), add: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@controller/lib/outreach/suppress', () => ({ listSuppressions: m.list, addSuppression: m.add, removeSuppression: m.remove }))

import { GET, POST, DELETE } from '@controller/app/api/(admin)/admin/ecom/outreach/suppressions/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const url = 'http://localhost/api/admin/ecom/outreach/suppressions'
const post = (body: unknown) => POST(new NextRequest(url, { method: 'POST', body: JSON.stringify(body) }))
const del = (qs = '') => DELETE(new NextRequest(url + qs, { method: 'DELETE' }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] } as any)
  vi.mocked(isPlatformAdmin).mockReturnValue(true)
  m.list.mockResolvedValue({ rows: [{ phone: '+919876543210' }], total: 1 })
  m.add.mockResolvedValue({ phone: '+919876543210', contactsSuppressed: 2 })
  m.remove.mockResolvedValue(true)
})

describe('/api/admin/ecom/outreach/suppressions', () => {
  it('401 / 403 gates', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await GET(new NextRequest(url))).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await post({ phone: '9876543210' })).status).toBe(403)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await del('?phone=9876543210')).status).toBe(403)
    expect(m.add).not.toHaveBeenCalled()
    expect(m.remove).not.toHaveBeenCalled()
  })

  it('GET lists under the read scope', async () => {
    expect((await (await GET(new NextRequest(url + '?q=98'))).json()).total).toBe(1)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:read')
    expect(m.list).toHaveBeenCalledWith({ q: '98', page: 1, pageSize: 50 })
  })

  it('POST 400s on a missing or invalid number', async () => {
    expect((await post({})).status).toBe(400)
    m.add.mockResolvedValueOnce(null)
    expect((await post({ phone: '123' })).status).toBe(400)
  })

  it('POST suppresses the number with the admin as actor', async () => {
    const res = await post({ phone: '98765 43210', reason: 'asked on WhatsApp' })
    expect(res.status).toBe(201)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:write')
    expect(m.add).toHaveBeenCalledWith('98765 43210', { reason: 'asked on WhatsApp', source: 'admin', actor: 'admin:a1' })
  })

  it('DELETE needs a phone, lifts the suppression, and 404s when it was not listed', async () => {
    expect((await del()).status).toBe(400)
    expect((await del('?phone=9876543210')).status).toBe(200)
    expect(m.remove).toHaveBeenCalledWith('9876543210', 'admin:a1')
    m.remove.mockResolvedValueOnce(false)
    expect((await del('?phone=9876543210')).status).toBe(404)
  })
})
