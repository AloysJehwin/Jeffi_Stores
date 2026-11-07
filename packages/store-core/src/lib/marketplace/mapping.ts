import { AdapterUnavailableError, eventKey, type MarketplaceDocument, type OrderActionKind, type PushEvent } from './adapter'
import { MarketplaceApiError } from './http'
import { CHANNEL_LABEL, isMarketStatus, type MarketplaceChannel, type MarketStatus, type NormalizedLine, type NormalizedOrder, type ReturnInfo, type ReturnStatus } from './types'

// Field pickers the live adapters read push payloads with. Each field is a list of candidate keys
// (first present wins), so a field-name correction from the partner docs is a one-word edit in the
// adapter's mapping object.

export type Keys = readonly string[]

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** The first candidate key present on `o` (dotted paths reach into nested objects). */
export function pick(o: unknown, keys: Keys): unknown {
  if (!isObj(o)) return undefined
  for (const k of keys) {
    let v: unknown = o
    for (const part of k.split('.')) v = isObj(v) ? v[part] : undefined
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

export function pickStr(o: unknown, keys: Keys): string | null {
  const v = pick(o, keys)
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() || null : null
}

export function pickNum(o: unknown, keys: Keys): number | null {
  const v = pick(o, keys)
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[,₹\s]/g, '')) : NaN
  return Number.isFinite(n) ? n : null
}

export function pickArr(o: unknown, keys: Keys): unknown[] {
  const v = pick(o, keys)
  return Array.isArray(v) ? v : []
}

export function pickObj(o: unknown, keys: Keys): Obj | null {
  const v = pick(o, keys)
  return isObj(v) ? v : null
}

/** ISO time for a string or epoch (seconds or milliseconds), or null. */
export function pickIso(o: unknown, keys: Keys): string | null {
  const v = pick(o, keys)
  let t = NaN
  if (typeof v === 'number') t = v < 1e12 ? v * 1000 : v
  else if (typeof v === 'string') t = /^\d{10,13}$/.test(v) ? Number(v) * (v.length === 10 ? 1000 : 1) : Date.parse(v)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** A marketplace status code through the adapter's map (case and separators ignored). */
export function statusFrom(map: Record<string, MarketStatus>, raw: unknown): MarketStatus | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  return map[raw.trim().toUpperCase().replace(/[\s-]+/g, '_')] ?? null
}

/** The body's list of records: an array, the first list key present, or the body itself. */
export function recordsOf(body: unknown, listKeys: Keys): Obj[] {
  const list = Array.isArray(body) ? body : pickArr(body, listKeys).length ? pickArr(body, listKeys) : isObj(body) ? [body] : []
  return list.filter(isObj)
}

const RANKED: MarketStatus[] = ['created', 'accepted', 'packed', 'ready_to_dispatch', 'shipped', 'delivered']

/** The order's status from its lines: the least advanced live line, else the terminal outcome. */
export function rollupStatus(lines: (MarketStatus | null | undefined)[]): MarketStatus | null {
  const known = lines.filter((s): s is MarketStatus => !!s)
  if (!known.length) return null
  const live = known.filter(s => RANKED.includes(s))
  if (live.length) return RANKED[Math.min(...live.map(s => RANKED.indexOf(s)))]
  if (known.includes('returned')) return 'returned'
  if (known.includes('cancelled')) return 'cancelled'
  return 'rejected'
}

/** A PDF from a document endpoint: the body itself, base64 in JSON, or an https URL in JSON. */
export async function readDocument(res: Response, filename: string, fieldKeys: { base64: Keys; url: Keys }): Promise<MarketplaceDocument> {
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('json')) {
    return { contentType: type.split(';')[0] || 'application/pdf', filename, body: Buffer.from(await res.arrayBuffer()) }
  }
  const json = await res.json().catch(() => null)
  const b64 = pickStr(json, fieldKeys.base64)
  if (b64) return { contentType: 'application/pdf', filename, body: Buffer.from(b64.replace(/^data:[^,]+,/, ''), 'base64') }
  const url = pickStr(json, fieldKeys.url)
  if (url && url.startsWith('https://')) {
    const file = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) })
    if (!file.ok) throw new MarketplaceApiError(`The document link returned HTTP ${file.status}`, file.status, '')
    return { contentType: (file.headers.get('content-type') ?? 'application/pdf').split(';')[0], filename, body: Buffer.from(await file.arrayBuffer()) }
  }
  throw new MarketplaceApiError('The marketplace returned no document', res.status, JSON.stringify(json ?? {}).slice(0, 500))
}

export const chunk = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += Math.max(1, size)) out.push(list.slice(i, i + Math.max(1, size)))
  return out
}

/** Where an adapter finds each order field in a pushed record. */
export interface PushMap {
  list: Keys
  eventId: Keys
  eventType: Keys
  orderId: Keys
  status: Keys
  eventAt: Keys
  placedAt: Keys
  acceptBy: Keys
  dispatchBy: Keys
  total: Keys
  invoiceRef: Keys
  city: Keys
  state: Keys
  postalCode: Keys
  lines: Keys
  packetId: Keys
  tracking: Keys
  courier: Keys
  trackingUrl: Keys
  manifestId: Keys
  line: { id: Keys; sku: Keys; styleId: Keys; title: Keys; size: Keys; colour: Keys; quantity: Keys; price: Keys; tax: Keys; mrp: Keys; status: Keys }
  return: { id: Keys; type: Keys; status: Keys; reason: Keys; lineIds: Keys; refund: Keys; tracking: Keys }
  po?: { number: Keys; date: Keys; amount: Keys; buyerGstin: Keys; buyerName: Keys }
  statuses: Record<string, MarketStatus>
  returnStatuses: Record<string, ReturnStatus>
}

/** Our status for an order action the marketplace accepted without saying the new status. */
export const ACTION_STATUS: Record<OrderActionKind, MarketStatus> = {
  accept: 'accepted',
  reject: 'rejected',
  pack: 'packed',
  ready_to_dispatch: 'ready_to_dispatch',
  cancel: 'cancelled',
}

/** A push the field mapping doesn't recognise: kept as one raw event and parked, never dropped. */
const unmapped = (channel: MarketplaceChannel, what: string) =>
  new AdapterUnavailableError(channel, `${CHANNEL_LABEL[channel]} ${what}; it is kept and processed once the field mapping is updated.`)

/** One event per pushed record. */
export function eventsFrom(channel: MarketplaceChannel, body: unknown, map: PushMap): PushEvent[] {
  const records = recordsOf(body, map.list)
  if (!records.length) throw unmapped(channel, "sent a push the field mapping doesn't recognise")
  return records.map(r => {
    const orderId = pickStr(r, map.orderId)
    if (!orderId) throw unmapped(channel, 'sent an order with no id the field mapping can find')
    const lineStates = pickArr(r, map.lines).map(l => pickStr(l, map.line.status) ?? '').join(',')
    const id = pickStr(r, map.eventId)
    const po = map.po ? pickStr(r, map.po.number) : null
    const ret = pickStr(r, map.return.id)
    const status = pickStr(r, map.status)
    return {
      key: id ?? eventKey(channel, orderId, status, pickStr(r, map.eventAt), pickStr(r, map.packetId), po, ret, pickStr(r, map.return.status), lineStates),
      type: (pickStr(r, map.eventType) ?? (po ? 'purchase_order' : ret ? 'return' : `order.${(status ?? 'update').toLowerCase()}`)).slice(0, 100),
      externalOrderId: orderId,
      occurredAt: pickIso(r, map.eventAt),
      payload: r,
    }
  })
}

const terminal = (s: MarketStatus) => s === 'returned' || s === 'cancelled' || s === 'rejected'

/** A pushed record as a NormalizedOrder; null when it is not about an order. An order whose status
 * code isn't in the mapping is parked (AdapterUnavailableError) rather than ignored. */
export function normalizeRecord(channel: MarketplaceChannel, map: PushMap, rec: unknown, event?: Pick<PushEvent, 'occurredAt'>): NormalizedOrder | null {
  const orderId = pickStr(rec, map.orderId)
  if (!orderId) return null
  const lines: NormalizedLine[] = []
  pickArr(rec, map.lines).forEach((l, i) => {
    const sku = pickStr(l, map.line.sku)
    if (!sku) return
    const rawLine = pickStr(l, map.line.status)
    lines.push({
      lineId: pickStr(l, map.line.id) ?? `${orderId}-${i + 1}`,
      sku,
      styleId: pickStr(l, map.line.styleId),
      title: pickStr(l, map.line.title),
      size: pickStr(l, map.line.size),
      colour: pickStr(l, map.line.colour),
      quantity: Math.max(1, Math.round(pickNum(l, map.line.quantity) ?? 1)),
      unitPrice: pickNum(l, map.line.price) ?? 0,
      unitTax: pickNum(l, map.line.tax),
      mrp: pickNum(l, map.line.mrp),
      status: statusFrom(map.statuses, rawLine),
    })
  })
  const rawStatus = pickStr(rec, map.status)
  const poNumber = map.po ? pickStr(rec, map.po.number) : null
  const returnId = pickStr(rec, map.return.id)
  let status = statusFrom(map.statuses, rawStatus) ?? rollupStatus(lines.map(l => l.status)) ?? (poNumber ? 'packed' : returnId ? 'returned' : null)
  if (!status || !isMarketStatus(status)) throw unmapped(channel, `order ${orderId} has a status ("${rawStatus ?? ''}") the field mapping doesn't recognise`)
  let returnInfo: ReturnInfo | null = null
  if (returnId) {
    const type = pickStr(rec, map.return.type)
    const lineIds = pickArr(rec, map.return.lineIds).map(String).filter(Boolean)
    returnInfo = {
      externalReturnId: returnId,
      type: type && /rto/i.test(type) ? 'rto' : 'customer',
      status: statusFromReturn(map.returnStatuses, pickStr(rec, map.return.status)) ?? 'initiated',
      reason: pickStr(rec, map.return.reason),
      lineIds,
      refundAmount: pickNum(rec, map.return.refund),
      trackingNumber: pickStr(rec, map.return.tracking),
    }
    if (!terminal(status)) status = 'returned'
  }
  const packetId = pickStr(rec, map.packetId)
  const tracking = pickStr(rec, map.tracking)
  const manifestId = pickStr(rec, map.manifestId)
  const lineTotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)
  return {
    channel,
    externalOrderId: orderId,
    status,
    rawStatus: rawStatus ?? null,
    eventAt: pickIso(rec, map.eventAt) ?? event?.occurredAt ?? null,
    placedAt: pickIso(rec, map.placedAt),
    acceptBy: pickIso(rec, map.acceptBy),
    dispatchBy: pickIso(rec, map.dispatchBy),
    currency: 'INR',
    total: pickNum(rec, map.total) ?? (lines.length ? lineTotal : null),
    shipping: { city: pickStr(rec, map.city), state: pickStr(rec, map.state), postalCode: pickStr(rec, map.postalCode), country: 'IN' },
    invoiceRef: pickStr(rec, map.invoiceRef),
    po:
      map.po && poNumber
        ? { number: poNumber, date: pickIso(rec, map.po.date), amount: pickNum(rec, map.po.amount), buyerGstin: pickStr(rec, map.po.buyerGstin), buyerName: pickStr(rec, map.po.buyerName) }
        : null,
    shipment: packetId || tracking || manifestId ? { packetId, trackingNumber: tracking, courier: pickStr(rec, map.courier), trackingUrl: pickStr(rec, map.trackingUrl), manifestId } : null,
    returnInfo,
    lines,
    raw: rec,
  }
}

function statusFromReturn(map: Record<string, ReturnStatus>, raw: string | null): ReturnStatus | null {
  if (!raw) return null
  return map[raw.trim().toUpperCase().replace(/[\s-]+/g, '_')] ?? null
}
