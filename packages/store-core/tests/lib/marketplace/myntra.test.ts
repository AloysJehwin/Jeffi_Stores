import { describe, it, expect, vi, afterEach } from 'vitest'
import { myntraAdapter } from '@/lib/marketplace/myntra'
import { AdapterUnavailableError } from '@/lib/marketplace/adapter'
import { clearTokenCache } from '@/lib/marketplace/http'

const adapter = myntraAdapter({ mode: 'sandbox', fields: { merchant_id: 'M-1', secret_key: 'sk', warehouse_ids: '11, 12' } })

const push = {
  orders: [
    {
      eventId: 'evt-1',
      orderReleaseId: 'MR-1001',
      orderStatus: 'WP',
      eventTime: '2026-11-07T10:00:00Z',
      orderDate: '2026-11-07T09:55:00Z',
      acceptBy: '2026-11-08T09:55:00Z',
      invoiceNumber: 'MYN-INV-77',
      shippingAddress: { city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' },
      orderLines: [
        { orderLineId: 'L1', sellerSkuCode: 'TEE-RED-M', styleId: 'S9', productName: 'Crew Tee', size: 'M', quantity: 2, sellingPrice: '499.00', mrp: 799, status: 'WP' },
        { orderLineId: 'L2', sellerSkuCode: 'TEE-BLU-L', sellingPrice: 549, status: 'WP' },
      ],
    },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
  clearTokenCache()
})

describe('myntra push mapping', () => {
  it('splits a push into one event per order, keyed by the event id', () => {
    const events = adapter.parsePush(push, new Headers())
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ key: 'evt-1', externalOrderId: 'MR-1001', occurredAt: '2026-11-07T10:00:00.000Z' })
  })

  it('normalises an order push', () => {
    const [ev] = adapter.parsePush(push, new Headers())
    const o = adapter.normalize(ev)!
    expect(o).toMatchObject({
      channel: 'myntra',
      externalOrderId: 'MR-1001',
      status: 'accepted',
      rawStatus: 'WP',
      acceptBy: '2026-11-08T09:55:00.000Z',
      invoiceRef: 'MYN-INV-77',
      shipping: { city: 'Chennai', state: 'Tamil Nadu', postalCode: '600001', country: 'IN' },
      total: 1547,
    })
    expect(o.lines[0]).toMatchObject({ lineId: 'L1', sku: 'TEE-RED-M', styleId: 'S9', size: 'M', quantity: 2, unitPrice: 499, mrp: 799, status: 'accepted' })
    expect(o.lines[1]).toMatchObject({ lineId: 'L2', quantity: 1, unitPrice: 549 })
  })

  it('takes the least advanced live line when the order has no status of its own', () => {
    const rec = { orderReleaseId: 'MR-2', orderLines: [{ orderLineId: 'a', sellerSkuCode: 'X', status: 'RTD' }, { orderLineId: 'b', sellerSkuCode: 'Y', status: 'PK' }, { orderLineId: 'c', sellerSkuCode: 'Z', status: 'C' }] }
    expect(adapter.normalize({ key: 'k', type: 't', externalOrderId: 'MR-2', occurredAt: null, payload: rec })!.status).toBe('packed')
  })

  it('maps events to statuses, with shipment details on RTD', () => {
    const at = (orderStatus: string, extra: Record<string, unknown> = {}) =>
      adapter.normalize({ key: 'k', type: 't', externalOrderId: 'MR-3', occurredAt: null, payload: { orderReleaseId: 'MR-3', orderStatus, ...extra } })!
    expect(at('Q').status).toBe('created')
    expect(at('RFR', { packetId: 'P-9', trackingNumber: 'TRK1', courierCode: 'EK' })).toMatchObject({ status: 'ready_to_dispatch', shipment: { packetId: 'P-9', trackingNumber: 'TRK1', courier: 'EK' } })
    expect(at('SH').status).toBe('shipped')
    expect(at('DL').status).toBe('delivered')
    expect(at('C').status).toBe('cancelled')
    expect(at('RTO').status).toBe('returned')
  })

  it('reads a return event', () => {
    const o = adapter.normalize({ key: 'k', type: 't', externalOrderId: 'MR-4', occurredAt: null, payload: { orderReleaseId: 'MR-4', orderStatus: 'DL', returnId: 'R-1', returnType: 'RTO', returnStatus: 'PICKED_UP', returnReason: 'Undelivered' } })!
    expect(o.status).toBe('returned')
    expect(o.returnInfo).toMatchObject({ externalReturnId: 'R-1', type: 'rto', status: 'in_transit', reason: 'Undelivered' })
  })

  it('parks a push the mapping does not recognise instead of dropping it', () => {
    expect(() => adapter.parsePush({ something: 'else' }, new Headers())).toThrow(AdapterUnavailableError)
    expect(() => adapter.normalize({ key: 'k', type: 't', externalOrderId: 'MR-5', occurredAt: null, payload: { orderReleaseId: 'MR-5', orderStatus: 'BRAND_NEW_CODE' } })).toThrow(AdapterUnavailableError)
  })
})

describe('myntra order actions', () => {
  it('logs in once and returns the RTD packet, tracking and courier', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        const body = url.endsWith('/v4/auth/token') ? { accessToken: 'tok', expiresIn: 3600 } : { success: true, packetId: 'P-1', trackingNumber: 'TRK-1', courierCode: 'EK' }
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
      })
    )
    const r = await adapter.orderAction({ action: 'ready_to_dispatch', externalOrderId: 'MR-1001', lineIds: ['L1'] })
    expect(r).toMatchObject({ ok: true, status: 'ready_to_dispatch', shipment: { packetId: 'P-1', trackingNumber: 'TRK-1', courier: 'EK' } })
    expect(calls.map(c => c.url)).toEqual(['https://sandbox-partner-api.myntra.com/v4/auth/token', 'https://sandbox-partner-api.myntra.com/v4/orders/MR-1001/lines/events'])
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({ event: 'RTD', orderLineIds: ['L1'] })
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })
})
