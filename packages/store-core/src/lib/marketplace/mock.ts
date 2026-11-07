import { createHash } from 'crypto'
import { eventKey, type MarketplaceAdapter, type MarketplaceDocument, type PushEvent } from './adapter'
import { CHANNEL_LABEL, type MarketplaceChannel, type MarketStatus, type NormalizedLine, type NormalizedOrder } from './types'

// Deterministic stand-in for both marketplaces: local dev, tests and the connect panel's "Send test
// order". Nothing leaves the platform. Its push body is { orders: MockPushOrder[] } (or one order).

export interface MockPushLine {
  lineId: string
  sku: string
  quantity?: number
  price: number
  tax?: number
  mrp?: number
  title?: string
  size?: string
  colour?: string
  styleId?: string
}

export interface MockPushOrder {
  eventId?: string
  orderId: string
  /** CREATED, ACCEPTED, PACKED, RTD, SHIPPED, DELIVERED, CANCELLED, REJECTED or RETURNED. */
  status: string
  eventTime?: string
  placedAt?: string
  acceptBy?: string
  lines?: MockPushLine[]
  shipping?: { city?: string; state?: string; postalCode?: string }
  invoiceRef?: string
  po?: { number: string; date?: string; amount?: number }
  packet?: { packetId?: string; trackingNumber?: string; courier?: string }
}

const STATUS: Record<string, MarketStatus> = {
  CREATED: 'created',
  NEW: 'created',
  ACCEPTED: 'accepted',
  PACKED: 'packed',
  RTD: 'ready_to_dispatch',
  READY_TO_DISPATCH: 'ready_to_dispatch',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
  RETURNED: 'returned',
}

const short = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 10).toUpperCase()

/** A one-page PDF with a line of text, enough for a label/invoice download to work. */
export function mockPdf(text: string): Buffer {
  const safe = text.replace(/[()\\]/g, '')
  const content = `BT /F1 14 Tf 24 400 Td (${safe}) Tj ET`
  return Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
      `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 288 432]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n` +
      `4 0 obj<</Length ${content.length}>>stream\n${content}\nendstream endobj\n` +
      `5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`
  )
}

function asOrders(body: unknown): MockPushOrder[] {
  const list = Array.isArray(body) ? body : body && typeof body === 'object' && Array.isArray((body as any).orders) ? (body as any).orders : [body]
  for (const o of list) {
    if (!o || typeof o !== 'object' || typeof o.orderId !== 'string' || !o.orderId || typeof o.status !== 'string') throw new Error('Invalid push body')
  }
  return list as MockPushOrder[]
}

export function mockAdapter(channel: MarketplaceChannel): MarketplaceAdapter {
  const doc = (kind: string, ref: string): MarketplaceDocument => ({
    contentType: 'application/pdf',
    filename: `${channel}-${kind}-${ref}.pdf`,
    body: mockPdf(`${CHANNEL_LABEL[channel]} ${kind} ${ref} (mock)`),
  })
  return {
    channel,
    mode: 'mock',
    async test() {
      return { ok: true, message: 'Mock mode: nothing is sent to the marketplace.' }
    },
    parsePush(body) {
      return asOrders(body).map(o => ({
        key: o.eventId ? String(o.eventId) : eventKey('mock', o.orderId, o.status, o.eventTime ?? '', o.packet?.packetId ?? ''),
        type: `order.${o.status.toLowerCase()}`,
        externalOrderId: o.orderId,
        occurredAt: o.eventTime ?? null,
        payload: o,
      }))
    },
    normalize(event: PushEvent): NormalizedOrder | null {
      const o = event.payload as MockPushOrder
      const status = STATUS[String(o?.status ?? '').toUpperCase()]
      if (!status || !o.orderId) return null
      const lines: NormalizedLine[] = (o.lines ?? []).map(l => ({
        lineId: String(l.lineId),
        sku: String(l.sku),
        styleId: l.styleId ?? null,
        title: l.title ?? null,
        size: l.size ?? null,
        colour: l.colour ?? null,
        quantity: Math.max(1, Math.round(Number(l.quantity ?? 1))),
        unitPrice: Number(l.price) || 0,
        unitTax: l.tax == null ? null : Number(l.tax),
        mrp: l.mrp == null ? null : Number(l.mrp),
      }))
      return {
        channel,
        externalOrderId: o.orderId,
        status,
        rawStatus: o.status,
        eventAt: o.eventTime ?? event.occurredAt ?? null,
        placedAt: o.placedAt ?? null,
        acceptBy: o.acceptBy ?? null,
        currency: 'INR',
        total: lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
        shipping: o.shipping ? { city: o.shipping.city ?? null, state: o.shipping.state ?? null, postalCode: o.shipping.postalCode ?? null, country: 'IN' } : null,
        invoiceRef: o.invoiceRef ?? null,
        po: o.po ? { number: o.po.number, date: o.po.date ?? null, amount: o.po.amount ?? null } : null,
        shipment: o.packet ? { packetId: o.packet.packetId ?? null, trackingNumber: o.packet.trackingNumber ?? null, courier: o.packet.courier ?? null } : null,
        lines,
        raw: o,
      }
    },
    async ack() {},
    async pushInventory(updates) {
      return updates.map(u => ({ sku: u.sku, warehouseId: u.warehouseId ?? null, ok: true }))
    },
    async orderAction(input) {
      const status: MarketStatus =
        input.action === 'accept' ? 'accepted' : input.action === 'reject' ? 'rejected' : input.action === 'pack' ? 'packed' : input.action === 'cancel' ? 'cancelled' : 'ready_to_dispatch'
      const shipment =
        status === 'ready_to_dispatch'
          ? { packetId: `PKT-${short(input.externalOrderId)}`, trackingNumber: `MOCK${short(`trk:${input.externalOrderId}`)}`, courier: 'Mock Courier', lineIds: input.lineIds ?? [] }
          : null
      return { ok: true, status, shipment, message: 'Mock mode' }
    },
    async document(kind, externalOrderId, ref) {
      return doc(kind, ref ?? externalOrderId)
    },
    async createManifest(packetIds) {
      const manifestId = `MAN-${short([...packetIds].sort().join(','))}`
      return { manifestId, document: doc('manifest', manifestId) }
    },
    async submitListings(rows) {
      return { taskId: `TASK-${short(rows.map(r => r.sku).join(','))}` }
    },
    async listingTask(taskId) {
      return { taskId, status: 'done', rows: [] }
    },
    async returnAction() {
      return { ok: true, message: 'Mock mode' }
    },
    async settlements() {
      return []
    },
  }
}

/** The push body "Send test order" records: one accepted order for `sku`. */
export function mockTestOrder(sku: string, price: number, orderId: string, now = new Date()): MockPushOrder {
  return {
    eventId: `test:${orderId}`,
    orderId,
    status: 'ACCEPTED',
    eventTime: now.toISOString(),
    placedAt: now.toISOString(),
    acceptBy: new Date(now.getTime() + 24 * 3600_000).toISOString(),
    lines: [{ lineId: `${orderId}-1`, sku, quantity: 1, price, title: 'Test order' }],
    shipping: { city: 'Chennai', state: 'Tamil Nadu', postalCode: '600001' },
  }
}
