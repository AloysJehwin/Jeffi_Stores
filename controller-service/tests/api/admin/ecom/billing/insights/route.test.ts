import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const query = vi.fn()
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))

import { GET } from '@controller/app/api/(admin)/admin/ecom/billing/insights/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/ecom/billing/insights${qs}`)

describe('GET /api/admin/ecom/billing/insights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a', role: 'administrator', scopes: [] } as any)
    vi.mocked(isPlatformAdmin).mockReturnValue(true)
    query.mockImplementation(async (sql: string) => ({ rows: sql.includes('AS today') ? [{ today: '2026-11-26' }] : [{ day: '2026-11-26', s0: '3', s1: '1' }] }))
  })

  it('is gated on ecom_billing:read and platform admin', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await GET(req())).status).toBe(401)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_billing:read')
    vi.mocked(isPlatformAdmin).mockReturnValueOnce(false)
    expect((await GET(req())).status).toBe(403)
    expect(query).not.toHaveBeenCalled()
  })

  it('returns the daily series from the control plane', async () => {
    const res = await GET(req('?weeks=13'))
    expect(res.status).toBe(200)
    const { series } = await res.json()
    expect(series.weeks).toBe(13)
    expect(series.days).toHaveLength(91)
    expect(series.series.map((s: any) => s.key)).toEqual(['kept', 'refunded'])
    expect(series.days.find((d: any) => d.date === '2026-11-26').values).toEqual([3, 1])
    expect(query.mock.calls.some(c => String(c[0]).includes('FROM billing_charges'))).toBe(true)
  })

  it('rejects an unknown period without querying', async () => {
    expect((await GET(req('?weeks=7'))).status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it('answers 500 when the query fails', async () => {
    query.mockRejectedValue(new Error('db'))
    expect((await GET(req())).status).toBe(500)
  })
})
