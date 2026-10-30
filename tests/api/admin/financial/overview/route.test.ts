import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { GET } from '@controller/app/api/(admin)/admin/financial/overview/route'
import { periodTotals } from '@controller/app/api/(admin)/admin/financial/overview/summary'
import { requireAdminScope } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany, queryOne } from '@/lib/shared/db'

const admin = { adminId: 'a1', role: 'manager', scopes: ['financial:read'] }
const req = (qs = '') => new NextRequest(`http://localhost/api/admin/financial/overview${qs}`)

const totalsRow = {
  revenue: '1000',
  orders: '4',
  cogs: '300',
  refunds: '100',
  refunds_out: '50',
  supplier_payments: '200',
  refunds_issued: '50',
  refunds_issued_count: '1',
  gst_output: '90',
  gst_itc: '30',
}

describe('GET /api/admin/financial/overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue(admin as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(totalsRow as any)
    vi.mocked(queryMany).mockResolvedValue([])
  })

  it('is gated on financial:read', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'financial:read')
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('rejects a bad range', async () => {
    expect((await GET(req('?from=2026-10-10&to=2026-10-01'))).status).toBe(400)
    expect((await GET(req('?from=2026-10-10'))).status).toBe(400)
  })

  it('returns the period, the previous period and the snapshot', async () => {
    const res = await GET(req('?from=2026-10-01&to=2026-10-10'))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.range).toEqual({ from: '2026-10-01', to: '2026-10-10' })
    expect(j.previous_range).toEqual({ from: '2026-09-21', to: '2026-09-30' })
    expect(j.bucket).toBe('day')
    expect(j.series).toHaveLength(10)
    expect(j.current).toMatchObject({ net_sales: 900, gross_profit: 600, outflow: 250, net_cash: 750, gst_payable: 60 })
    expect(j.receivables.aging.map((b: any) => b.key)).toEqual(['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'])
    expect(j.attention.cod_stale_days).toBe(7)
    const firstParams = vi.mocked(queryOne).mock.calls[0][1]
    expect(firstParams).toEqual(['2026-10-01', '2026-10-10', true])
  })

  it('leaves GST out without gst:read', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const j = await (await GET(req())).json()
    expect(j.current.gst_payable).toBeNull()
    expect(vi.mocked(queryOne).mock.calls[0][1]?.[2]).toBe(false)
  })
})

describe('periodTotals', () => {
  it('has no margin without cost prices', async () => {
    vi.mocked(queryOne).mockResolvedValue({ ...totalsRow, cogs: '0' } as any)
    const t = await periodTotals({ from: '2026-10-01', to: '2026-10-10' }, false)
    expect(t.gross_margin).toBeNull()
    expect(t.gst_output).toBeNull()
  })
})
