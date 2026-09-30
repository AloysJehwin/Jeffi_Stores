import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))
vi.mock('@/lib/documents/shipping-label-pdf', () => ({
  buildMergedLabelsPDF: vi.fn().mockResolvedValue(Buffer.from('%PDF-merged')),
}))

import { GET } from '@/app/api/admin/delhivery/pickup-request/[id]/labels/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, queryMany } from '@/lib/shared/db'
import { buildMergedLabelsPDF } from '@/lib/documents/shipping-label-pdf'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockBuild = vi.mocked(buildMergedLabelsPDF)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['orders'] }
const PID = 'pickup-uuid-1'
const req = () => new NextRequest(`http://localhost/api/admin/delhivery/pickup-request/${PID}/labels`)
const params = { params: Promise.resolve({ id: PID }) }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET pickup-request/[id]/labels', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await GET(req(), params)).status).toBe(401)
  })

  it('403 without orders:read', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(false)
    expect((await GET(req(), params)).status).toBe(403)
  })

  it('404 when pickup request not found', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    expect((await GET(req(), params)).status).toBe(404)
  })

  it('404 when the pickup request has no AWBs', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: PID, pickup_id: 'PU-1', awbs: [] } as any)
    expect((await GET(req(), params)).status).toBe(404)
  })

  it('returns a merged PDF with one label per AWB', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: PID, pickup_id: 'PU-1', awbs: ['AWB1', 'AWB2'] } as any)
    // first queryMany = orders, second = order_items
    mockQueryMany
      .mockResolvedValueOnce([
        {
          id: 'o1',
          order_number: 'ORD-1',
          awb_number: 'AWB1',
          total_amount: '100',
          payment_mode: 'cod',
          payment_status: 'cod_pending',
        },
        {
          id: 'o2',
          order_number: 'ORD-2',
          awb_number: 'AWB2',
          total_amount: '200',
          payment_mode: 'razorpay',
          payment_status: 'paid',
        },
      ] as any)
      .mockResolvedValueOnce([
        { order_id: 'o1', product_name: 'Bolt', variant_name: 'M8', quantity: 2, unit_price: 25, total_price: 50 },
        { order_id: 'o2', product_name: 'Nut', variant_name: null, quantity: 1, unit_price: 200, total_price: 200 },
      ] as any)
    const res = await GET(req(), params)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    // built one label per AWB, in AWB order
    const labels = mockBuild.mock.calls[0][0]
    expect(labels).toHaveLength(2)
    expect(labels[0].awb).toBe('AWB1')
    expect(labels[1].awb).toBe('AWB2')
    // COD order gets a cod pkg amount; paid order does not
    expect(labels[0].pkg.cod).toBe('100')
    expect(labels[1].pkg.cod).toBeUndefined()
  })
})
