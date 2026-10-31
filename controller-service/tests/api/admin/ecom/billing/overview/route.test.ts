import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const query = vi.fn()
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))

import { GET } from '@controller/app/api/(admin)/admin/ecom/billing/overview/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/ecom/billing/overview${qs}`)
const soon = new Date(Date.now() - 27 * 86_400_000).toISOString()

function rows(sql: string) {
  if (sql.includes('AS new_mrr_prev'))
    return [
      {
        mrr: '12998',
        paying: 2,
        yearly: 0,
        new_mrr: '4999',
        new_mrr_prev: '0',
        churned_mrr: '2999',
        churned_mrr_prev: '2999',
        churned: 1,
        churned_prev: 1,
      },
    ]
  if (sql.includes('AS amount_prev')) return [{ n: 2, amount: '12998', n_prev: 1, amount_prev: '7999' }]
  if (sql.includes('AS gateway_fees'))
    return [
      { cur: true, gmv: '1000', commission: '50', gateway_fees: '20', refunds: '0', orders: 3, failed: 1 },
      { cur: false, gmv: '500', commission: '25', gateway_fees: '10', refunds: '0', orders: 1, failed: 0 },
    ]
  if (sql.includes('FROM wallet_ledger') && sql.includes('GROUP BY 1, 2, 3'))
    return [
      { cur: true, category: 'recharge', entry_type: 'recharge', amount: '1000', n: 1 },
      { cur: true, category: 'whatsapp', entry_type: 'debit', amount: '-40', n: 4 },
    ]
  if (sql.includes('AS last_charge'))
    return [
      {
        id: 't1',
        name: 'Acme',
        plan: 'growth',
        billing_interval: 'monthly',
        mrr: '4999',
        amount: '4999',
        last_charge: soon,
      },
    ]
  if (sql.includes("'failed_payment'")) return [{ kind: 'failed_payment', id: 't2', name: 'Bravo' }]
  return []
}

describe('GET /api/admin/ecom/billing/overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a', role: 'administrator', scopes: [] } as any)
    vi.mocked(isPlatformAdmin).mockReturnValue(true)
    query.mockImplementation(async (sql: string) => ({ rows: rows(sql) }))
  })

  it('is gated on ecom_billing:read and platform admin', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await GET(req())).status).toBe(401)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_billing:read')
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a', role: 'manager', scopes: [] } as any)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await GET(req())).status).toBe(403)
    expect(query).not.toHaveBeenCalled()
  })

  it('returns MRR, movement, collections, wallet revenue and renewals', async () => {
    const j = await (await GET(req('?from=2026-10-01&to=2026-10-10'))).json()
    expect(j.snapshot).toMatchObject({ mrr: 12998, arr: 155976, paying: 2, arpa: 6499 })
    expect(j.current).toMatchObject({
      new_mrr: 4999,
      churned_mrr: 2999,
      net_new_mrr: 2000,
      collected: 12998,
      charges: 2,
      gmv: 1000,
      commission: 50,
      failed: 1,
    })
    expect(j.previous).toMatchObject({ net_new_mrr: -2999, gmv: 500 })
    expect(j.current.wallet).toMatchObject({ topups: 1000, topup_count: 1, messaging: 40 })
    expect(j.deltas.gmv).toBe(1)
    expect(j.renewals_7d).toHaveLength(1)
    expect(j.renewals_7d[0]).toMatchObject({ id: 't1', amount: 4999 })
    expect(j.attention[0]).toMatchObject({ key: 'failed_payment', severity: 'critical' })
  })
})
