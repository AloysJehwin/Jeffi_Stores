import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/overviews/quotations', () => ({ loadQuotationOverview: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/quotations/overview/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { loadQuotationOverview } from '@/lib/overviews/quotations'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/quotations/overview${qs}`)

describe('GET /api/admin/quotations/overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: ['quotations:read'] } as any)
    vi.mocked(loadQuotationOverview).mockResolvedValue({ attention: [] } as any)
  })

  it('is gated on quotations:read', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'quotations:read')
    expect(loadQuotationOverview).not.toHaveBeenCalled()
  })

  it('passes the requested period', async () => {
    const res = await GET(req('?from=2026-10-01&to=2026-10-10'))
    expect(res.status).toBe(200)
    expect(vi.mocked(loadQuotationOverview).mock.calls[0][0]).toEqual({ from: '2026-10-01', to: '2026-10-10' })
  })

  it('falls back to 30 days on a bad range', async () => {
    await GET(req('?from=2026-10-10&to=2026-10-01'))
    const p = vi.mocked(loadQuotationOverview).mock.calls[0][0]
    expect(p.from < p.to).toBe(true)
  })

  it('returns 500 when the query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(loadQuotationOverview).mockRejectedValue(new Error('boom'))
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect((await res.json()).error).not.toContain('boom')
  })
})
