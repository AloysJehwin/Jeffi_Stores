import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))
vi.mock('@/lib/catalog/site-controls', () => ({
  getBusinessValues: vi.fn(async () => ({ eddSettingsJson: '{"handlingDays":3}', delhiveryOriginPincode: '492001' })),
}))

import { GET as ordersGET } from '@admin/app/api/(admin)/admin/orders/overview/route'
import { GET as delhiveryGET } from '@admin/app/api/(admin)/admin/delhivery/overview/route'
import { GET as returnsGET } from '@admin/app/api/(admin)/admin/returns/overview/route'
import { GET as replacementsGET } from '@admin/app/api/(admin)/admin/replacements/overview/route'
import { GET as packingGET } from '@admin/app/api/(admin)/admin/packing-slips/overview/route'
import { GET as labelsGET } from '@admin/app/api/(admin)/admin/labels/overview/route'
import { GET as scanGET } from '@admin/app/api/(admin)/admin/scan/overview/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'

const admin = { adminId: 'a1', role: 'manager', scopes: [] }
const req = (path: string, qs = '?from=2026-10-01&to=2026-10-10') => new NextRequest(`http://localhost/api/admin/${path}/overview${qs}`)

const cases = [
  ['orders', ordersGET, 'orders:read'],
  ['delhivery', delhiveryGET, 'delhivery:read'],
  ['returns', returnsGET, 'returns:read'],
  ['replacements', replacementsGET, 'replacements:read'],
  ['packing-slips', packingGET, 'packing_slips:read'],
  ['labels', labelsGET, 'labels:read'],
  ['scan', scanGET, 'quick_scan:read'],
] as const

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue(admin as any)
  vi.mocked(queryMany).mockResolvedValue([])
  vi.mocked(queryOne).mockResolvedValue({} as any)
})

describe.each(cases)('GET /api/admin/%s/overview', (path, GET, scope) => {
  it(`is gated on ${scope}`, async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    const res = await GET(req(path))
    expect(res.status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), scope)
    expect(queryMany).not.toHaveBeenCalled()
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('returns the period, the previous period and attention', async () => {
    const res = await GET(req(path))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.period).toEqual({ from: '2026-10-01', to: '2026-10-10' })
    expect(j.previous).toEqual({ from: '2026-09-21', to: '2026-09-30' })
    expect(Array.isArray(j.attention)).toBe(true)
  })

  it('falls back to the default period on a bad range', async () => {
    const j = await (await GET(req(path, '?from=2026-10-10&to=2026-10-01'))).json()
    expect(j.period.to >= j.period.from).toBe(true)
  })

  it('answers 500 when the query fails', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await GET(req(path))).status).toBe(500)
  })
})

describe('orders overview shape', () => {
  it('maps KPIs per period and uses the store handling days', async () => {
    vi.mocked(queryMany).mockImplementation(async (sql: string) => {
      if (sql.includes('AS placed'))
        return [
          { period: 'cur', placed: '10', live: '8', value: '800', paid_value: '700', cancelled: '2', cod: '2', cod_value: '100' },
          { period: 'prev', placed: '5', live: '5', value: '400', paid_value: '400', cancelled: '0', cod: '0', cod_value: '0' },
        ]
      return []
    })
    vi.mocked(queryOne).mockResolvedValue({ late_to_ship: '4', to_ship: '6' } as any)
    const j = await (await ordersGET(req('orders'))).json()
    expect(j.handlingDays).toBe(3)
    expect(j.kpis.current).toMatchObject({ placed: 10, value: 800, aov: 100, cancelRate: 0.2, cod: 2, prepaid: 6, codShare: 0.25 })
    expect(j.kpis.previous).toMatchObject({ placed: 5, aov: 80 })
    expect(j.attention[0]).toMatchObject({ key: 'late_to_ship', title: '4 orders past the 3-day dispatch window' })
    expect(j.pipeline.map((p: any) => p.status)).toContain('pending')
    const snapCall = vi.mocked(queryOne).mock.calls.find(c => String(c[0]).includes('late_to_ship'))
    expect(snapCall?.[1]).toEqual([3])
  })
})

describe('returns overview type', () => {
  it('scopes returns to refund requests and replacements to replacement requests', async () => {
    await returnsGET(req('returns'))
    expect(vi.mocked(queryMany).mock.calls[0][1]).toEqual(['2026-09-21', '2026-10-01', '2026-10-10', 'refund'])
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue(admin as any)
    vi.mocked(queryMany).mockResolvedValue([])
    await replacementsGET(req('replacements'))
    expect(vi.mocked(queryMany).mock.calls[0][1]).toEqual(['2026-09-21', '2026-10-01', '2026-10-10', 'replacement'])
  })
})
