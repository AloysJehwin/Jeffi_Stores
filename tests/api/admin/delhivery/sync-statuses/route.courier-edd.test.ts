import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryMany: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendOrderStatusUpdate: vi.fn(async () => {}) }))
vi.mock('@/lib/shared/auto-tasks', () => ({ createAutoTask: vi.fn(async () => {}), completeAutoTask: vi.fn() }))
vi.mock('@/lib/orders/order-stock', () => ({ restoreOrderStock: vi.fn(async () => {}) }))
vi.mock('@/lib/shared/sms', () => ({ sendOrderDeliveredSMS: vi.fn(), sendOutForDeliverySMS: vi.fn() }))
vi.mock('@/lib/shipping/delhivery', () => ({
  fetchDelhiveryInvoiceCharges: vi.fn(async () => null),
  chargeableGrams: () => 0,
}))
vi.mock('@/lib/catalog/site-controls', () => ({
  getBusinessValues: vi.fn(async () => ({ delhiveryOriginPincode: '492001' })),
}))
vi.mock('@/lib/integrations/resolve', () => ({ resolveDelhiveryToken: vi.fn(async () => 'tok') }))

import { POST } from '@admin/app/api/(admin)/admin/delhivery/sync-statuses/route'
import { query, queryMany } from '@/lib/shared/db'

const mockQuery = vi.mocked(query)
const mockQueryMany = vi.mocked(queryMany)

const ORDER = {
  id: 'ord-1',
  awb_number: 'AWB001',
  status: 'shipped',
  shipment_status: 'in_transit',
  order_number: 'ORD-001',
  customer_name: 'A',
  customer_email: 'a@example.com',
  user_id: 'u1',
}

// Shape of a real track.delhivery.com/api/v1/packages/json Shipment (trimmed).
function payload(statusType: string, status: string, dates: Record<string, unknown>) {
  return {
    ShipmentData: [
      {
        Shipment: {
          AWB: 'AWB001',
          Origin: 'Raipur_Central_D (Chhattisgarh)',
          Destination: 'Chennai',
          PickUpDate: '2026-10-08T15:22:10.215',
          Status: {
            Status: status,
            StatusType: statusType,
            StatusDateTime: '2026-10-09T10:01:00.000',
            StatusLocation: 'Nagpur_Hub',
          },
          Scans: [{ ScanDetail: { Scan: status, ScanType: statusType, ScanDateTime: '2026-10-09T10:01:00.000' } }],
          ...dates,
        },
      },
    ],
  }
}

async function run(body: unknown) {
  process.env.CRON_SECRET = 'cron'
  mockQueryMany.mockResolvedValueOnce([ORDER] as any).mockResolvedValueOnce([])
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => body })) as any
  await POST(
    new NextRequest('http://localhost/api/admin/delhivery/sync-statuses', {
      method: 'POST',
      headers: { authorization: 'Bearer cron' },
    })
  )
  return mockQuery.mock.calls.find(([sql]) => String(sql).includes('courier_edd'))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
})

describe('sync-statuses — courier EDD', () => {
  it('writes ExpectedDeliveryDate (ISO datetime) as a date to courier_edd + estimated_delivery_date', async () => {
    const call = await run(payload('UD', 'In Transit', { ExpectedDeliveryDate: '2026-10-23T23:59:59' }))
    expect(call).toBeDefined()
    expect(String(call![0])).toMatch(/estimated_delivery_date = \$2::date/)
    expect(String(call![0])).toMatch(/courier_edd IS DISTINCT FROM/)
    expect(call![1]).toEqual(['ord-1', '2026-10-23', expect.any(Array), expect.any(Array)])
  })

  it('falls back to PromisedDeliveryDate when ExpectedDeliveryDate is null', async () => {
    const call = await run(
      payload('UD', 'In Transit', { ExpectedDeliveryDate: null, PromisedDeliveryDate: '2026-10-21T23:59:59' })
    )
    expect(call![1]![1]).toBe('2026-10-21')
  })

  it('parses a day-first 23-10-2026 date instead of failing the cast', async () => {
    const call = await run(payload('UD', 'In Transit', { ExpectedDeliveryDate: '23-10-2026' }))
    expect(call![1]![1]).toBe('2026-10-23')
  })

  it('ignores an empty / missing courier date (no write)', async () => {
    expect(await run(payload('UD', 'In Transit', { ExpectedDeliveryDate: '' }))).toBeUndefined()
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as any)
    expect(await run(payload('UD', 'In Transit', {}))).toBeUndefined()
  })

  it('never writes the courier EDD once the shipment is delivered', async () => {
    const call = await run(payload('DL', 'Delivered', { ExpectedDeliveryDate: '2026-10-30T23:59:59' }))
    expect(call).toBeUndefined()
  })
})
