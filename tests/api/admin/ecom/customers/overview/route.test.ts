import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const query = vi.fn()
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))

import { GET } from '@/app/api/(admin)/admin/ecom/customers/overview/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/ecom/customers/overview${qs}`)

function rows(sql: string) {
  if (sql.includes('AS signups_prev'))
    return [
      {
        total: 5,
        active: 3,
        signups: 4,
        signups_prev: 2,
        store_signups: 2,
        store_signups_prev: 1,
        store_live: 1,
        store_live_prev: 1,
        churned: 1,
        churned_prev: 0,
        live_stores: 2,
      },
    ]
  if (sql.includes('GROUP BY 1') && sql.includes('t.status, count'))
    return [
      { status: 'active', n: 3 },
      { status: 'suspended', n: 2 },
    ]
  if (sql.includes('t.service_types, t.status'))
    return [{ service_types: ['store'] }, { service_types: ['store', 'messaging'] }, { service_types: ['documents'] }]
  if (sql.includes("'service_approval'")) return [{ kind: 'service_approval', id: 't1', name: 'Acme' }]
  return []
}

describe('GET /api/admin/ecom/customers/overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a', role: 'administrator', scopes: [] } as any)
    vi.mocked(isPlatformAdmin).mockReturnValue(true)
    query.mockImplementation(async (sql: string) => ({ rows: rows(sql) }))
  })

  it('is gated on ecom_customers:read', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(
      NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    )
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_customers:read')
    expect(query).not.toHaveBeenCalled()
  })

  it('is platform-admin only', async () => {
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await GET(req())).status).toBe(403)
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects a bad range', async () => {
    expect((await GET(req('?from=2026-10-10&to=2026-10-01'))).status).toBe(400)
    expect((await GET(req('?from=2026-10-10'))).status).toBe(400)
  })

  it('returns the period, the previous period and attention', async () => {
    const j = await (await GET(req('?from=2026-10-01&to=2026-10-10'))).json()
    expect(j.range).toEqual({ from: '2026-10-01', to: '2026-10-10' })
    expect(j.previous_range).toEqual({ from: '2026-09-21', to: '2026-09-30' })
    expect(j.bucket).toBe('day')
    expect(j.current).toMatchObject({ signups: 4, store_signups: 2, store_live: 1, conversion: 0.5, churned: 1 })
    expect(j.deltas.signups).toBe(1)
    expect(j.by_status).toMatchObject({ active: 3, suspended: 2, pending_approval: 0 })
    expect(j.by_product).toEqual({ store: 1, both: 1, services: 1 })
    expect(j.attention[0]).toMatchObject({ key: 'service_approval', href: '/admin/ecom/customers/t1/view' })
    const totals = query.mock.calls.find(c => String(c[0]).includes('AS signups_prev'))!
    expect(totals[1]).toEqual(['2026-10-01', '2026-10-10', '2026-09-21', '2026-09-30'])
  })
})
