import { describe, it, expect, vi, afterEach } from 'vitest'
import { ajioAdapter } from '@/lib/marketplace/ajio'
import { clearTokenCache } from '@/lib/marketplace/http'

const adapter = ajioAdapter({ mode: 'live', fields: { seller_id: 'S-1', password: 'pw', pob_id: 'DV0001' } })
const ev = (payload: unknown) => ({ key: 'k', type: 't', externalOrderId: null, occurredAt: null, payload })

afterEach(() => {
  vi.unstubAllGlobals()
  clearTokenCache()
})

describe('ajio push mapping', () => {
  it('normalises an order push', () => {
    const body = {
      orders: [
        {
          orderId: 'FN-555',
          orderStatus: 'CONFIRMED',
          eventTime: '2026-11-07T08:00:00Z',
          shipBy: '2026-11-09T08:00:00Z',
          deliveryAddress: { city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
          items: [{ itemId: 'I1', sellerSku: 'KURTA-S', styleCode: 'ST1', quantity: 1, sellingPrice: 1299, mrp: 1999 }],
        },
      ],
    }
    const [e] = adapter.parsePush(body, new Headers())
    expect(e).toMatchObject({ externalOrderId: 'FN-555', type: 'order.confirmed' })
    expect(adapter.normalize(e)).toMatchObject({
      channel: 'ajio',
      externalOrderId: 'FN-555',
      status: 'accepted',
      dispatchBy: '2026-11-09T08:00:00.000Z',
      shipping: { city: 'Mumbai', postalCode: '400001' },
      lines: [{ lineId: 'I1', sku: 'KURTA-S', styleId: 'ST1', quantity: 1, unitPrice: 1299, mrp: 1999 }],
    })
  })

  it('reads the B2B purchase order event (raised when packed)', () => {
    const rec = { orderId: 'FN-555', eventType: 'PO_CREATED', poNumber: 'PO-42', poDate: '2026-11-07', poAmount: '980.50', buyerGstin: '27AABCR1718E1ZL', buyerName: 'Reliance Retail Ltd' }
    const [e] = adapter.parsePush(rec, new Headers())
    expect(e.type).toBe('PO_CREATED')
    const o = adapter.normalize(e)!
    expect(o.status).toBe('packed')
    expect(o.po).toEqual({ number: 'PO-42', date: '2026-11-07T00:00:00.000Z', amount: 980.5, buyerGstin: '27AABCR1718E1ZL', buyerName: 'Reliance Retail Ltd' })
  })

  it('maps events to statuses', () => {
    const status = (orderStatus: string) => adapter.normalize(ev({ orderId: 'FN-1', orderStatus }))!.status
    expect(['NEW', 'CONFIRMED', 'PACKED', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RTO'].map(status)).toEqual([
      'created',
      'accepted',
      'packed',
      'ready_to_dispatch',
      'shipped',
      'delivered',
      'cancelled',
      'returned',
    ])
    expect(adapter.normalize(ev({ orderId: 'FN-1', orderStatus: 'SHIPPED', shipmentId: 'SH-1', awbNumber: 'AWB9', courierName: 'Delhivery' }))!.shipment).toMatchObject({
      packetId: 'SH-1',
      trackingNumber: 'AWB9',
      courier: 'Delhivery',
    })
  })

  it('refuses a manifest over the packet limit without calling AJIO', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(adapter.createManifest!(Array.from({ length: 251 }, (_, i) => `SH-${i}`))).rejects.toThrow('at most 250')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('creates a manifest with the POB and returns its id', async () => {
    const calls: { url: string; body: any }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null })
        if (url.endsWith('/auth/login')) return Response.json({ token: 't' })
        if (url.endsWith('/manifests')) return Response.json({ manifestId: 'MAN-7' })
        return new Response('%PDF-1.4', { headers: { 'content-type': 'application/pdf' } })
      })
    )
    const r = await adapter.createManifest!(['SH-1', 'SH-2'])
    expect(r.manifestId).toBe('MAN-7')
    expect(r.document?.body.toString()).toBe('%PDF-1.4')
    expect(calls[1]).toEqual({ url: 'https://vms-api.ajio.com/api/v1/manifests', body: { pobId: 'DV0001', shipmentIds: ['SH-1', 'SH-2'] } })
    expect(calls[2].url).toBe('https://vms-api.ajio.com/api/v1/manifests/MAN-7')
  })
})
