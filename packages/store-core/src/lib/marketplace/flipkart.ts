import { createHash, timingSafeEqual } from 'crypto'
import type { MarketplaceCreds } from '@/lib/integrations/resolve'
import { eventKey, type DocumentKind, type InventoryResult, type ListingRow, type ListingTaskResult, type MarketplaceAdapter, type OrderActionInput, type OrderActionResult, type PushEvent, type ReturnActionInput } from './adapter'
import { endpointUrl, resolveEndpoints, type ResolvedEndpoints } from './endpoints'
import { MarketplaceApiError, cachedToken, marketplaceJson, marketplaceRequest } from './http'
import { ACTION_STATUS, chunk, eventsFrom, normalizeRecord, pick, pickArr, pickNum, pickStr, readDocument, type PushMap } from './mapping'

// Flipkart Marketplace Seller API v3 (seller.flipkart.com/api-docs). Our "order" is a Flipkart
// shipment: actions, labels and dispatch all key on the shipment id. Orders arrive already approved,
// so accept is a no-op; pack generates the label and invoice, then ready-to-dispatch and manifest.
// Notifications need a separate enrolment with Flipkart (VAPT + NDA), so the sync cron also polls
// pre-dispatch and cancelled shipments. Pushes are signed (FKLOGIN), not sent with our push token.

// confirm against a live payload: line price keys and the notification attribute names.
export const FLIPKART_MAP = {
  push: {
    list: ['shipments'],
    eventId: [],
    eventType: ['eventType'],
    orderId: ['shipmentId'],
    status: ['eventType', 'status'],
    eventAt: ['timestamp', 'updatedAt'],
    placedAt: ['orderDate'],
    acceptBy: [],
    dispatchBy: ['dispatchByDate'],
    total: [],
    invoiceRef: ['invoiceNumber'],
    city: ['deliveryAddress.city'],
    state: ['deliveryAddress.state'],
    postalCode: ['deliveryAddress.pinCode', 'deliveryAddress.pincode'],
    lines: ['orderItems'],
    packetId: ['shipmentId'],
    tracking: ['trackingId'],
    courier: ['courier'],
    trackingUrl: [],
    manifestId: [],
    line: {
      id: ['orderItemId'],
      sku: ['sku'],
      styleId: ['fsn'],
      title: ['title', 'productTitle'],
      size: [],
      colour: [],
      quantity: ['quantity'],
      price: ['priceComponents.sellingPrice', 'sellingPrice'],
      tax: [],
      mrp: [],
      status: ['status'],
    },
    return: {
      id: ['returnId'],
      type: ['returnType', 'source'],
      status: ['returnStatus', 'eventType'],
      reason: ['reason', 'returnReason'],
      lineIds: ['returnLineIds'],
      refund: [],
      tracking: ['returnTrackingId'],
    },
    statuses: {
      APPROVED: 'accepted',
      PACKING_IN_PROGRESS: 'accepted',
      FORM_FAILED: 'accepted',
      PACKED: 'packed',
      READY_TO_DISPATCH: 'ready_to_dispatch',
      PICKUP_COMPLETE: 'shipped',
      SHIPPED: 'shipped',
      DELIVERED: 'delivered',
      CANCELLED: 'cancelled',
      RETURN_REQUESTED: 'returned',
      RETURNED: 'returned',
      SHIPMENT_CREATED: 'accepted',
      SHIPMENT_PACKED: 'packed',
      SHIPMENT_READY_TO_DISPATCH: 'ready_to_dispatch',
      SHIPMENT_PICKUP_COMPLETE: 'shipped',
      SHIPMENT_SHIPPED: 'shipped',
      SHIPMENT_DELIVERED: 'delivered',
      SHIPMENT_CANCELLED: 'cancelled',
      RETURN_CREATED: 'returned',
      RETURN_PICKED_UP: 'returned',
      RETURN_COMPLETED: 'returned',
      RETURN_CANCELLED: 'returned',
    },
    returnStatuses: {
      RETURN_CREATED: 'initiated',
      CREATED: 'initiated',
      REQUESTED: 'initiated',
      RETURN_PICKED_UP: 'in_transit',
      RETURN_COMPLETED: 'received',
      COMPLETED: 'received',
      RETURN_CANCELLED: 'cancelled',
      CANCELLED: 'cancelled',
    },
  } satisfies PushMap,
  /** Notifications that change nothing we track; the next poll carries any new dates. */
  ignoredEvents: ['shipment_hold', 'shipment_unhold', 'shipment_dispatch_dates_changed', 'shipment_form_failed', 'return_item_tracking_id_update', 'return_expected_date_changed'],
  cancelReasons: ['not_enough_inventory', 'cannot_procure_item', 'b2b_order'],
  paths: { shipments: '/sellers/v3/shipments' },
  pollPages: 25,
  signatureSkewMs: 15 * 60_000,
} as const

type Obj = Record<string, any>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : [])

/** A notification or polled shipment flattened so the pickers find order items, tracking and the
 * shipment a return belongs to at the top level. */
export function flipkartRecord(r: Obj): Obj {
  const a = isObj(r.attributes) ? r.attributes : {}
  const items = arr(r.orderItems).length ? arr(r.orderItems) : arr(a.orderItems)
  const returnItems = arr(r.returnItems).length ? arr(r.returnItems) : arr(a.returnItems)
  const sub = arr(r.subShipments)[0] ?? arr(a.subShipments)[0] ?? {}
  const courier = sub.courierDetails?.deliveryDetails ?? sub.courierDetails?.pickupDetails ?? {}
  return {
    ...a,
    ...r,
    orderItems: items,
    shipmentId: r.shipmentId ?? a.shipmentId ?? returnItems[0]?.shipmentId ?? null,
    orderDate: r.orderDate ?? a.orderDate ?? items[0]?.orderDate ?? null,
    trackingId: r.trackingId ?? a.trackingId ?? courier.trackingId ?? null,
    courier: r.courier ?? a.courier ?? courier.vendorName ?? null,
    returnLineIds: returnItems.map(i => i.orderItemId).filter(Boolean),
    returnTrackingId: a.trackingId ?? null,
    reason: a.reason ?? returnItems[0]?.reason ?? null,
  }
}

const sha1 = (s: string) => createHash('sha1').update(s, 'utf8').digest()

/** Flipkart's notification signature: X-Authorization "FKLOGIN " + base64(appId:sig), where sig is
 * SHA-1 over date + notification URL + method + app secret (hex or base64 accepted). */
export function flipkartSignatureValid(
  input: { headers: Headers; url: string; method: string },
  fields: { app_id?: string; app_secret?: string },
  now = Date.now()
): boolean {
  if (!fields.app_id || !fields.app_secret) return false
  const h = input.headers
  const date = h.get('x-date') ?? h.get('x_date')
  const auth = h.get('x-authorization') ?? h.get('x_authorization')
  if (!date || !auth?.startsWith('FKLOGIN ')) return false
  const at = Date.parse(date)
  if (Number.isFinite(at) && Math.abs(now - at) > FLIPKART_MAP.signatureSkewMs) return false
  const decoded = Buffer.from(auth.slice(8).trim(), 'base64').toString('utf8')
  const sep = decoded.indexOf(':')
  if (sep < 0 || decoded.slice(0, sep) !== fields.app_id) return false
  const presented = decoded.slice(sep + 1).trim()
  const expected = sha1(`${date}${input.url}${input.method.toUpperCase()}${fields.app_secret}`)
  const asBytes = /^[0-9a-f]{40}$/i.test(presented) ? Buffer.from(presented, 'hex') : Buffer.from(presented, 'base64')
  return asBytes.length === expected.length && timingSafeEqual(asBytes, expected)
}

/** Events from a notification body or a page of polled shipments. */
export function flipkartEvents(body: unknown, source: 'push' | 'poll' = 'push'): PushEvent[] {
  const records = Array.isArray(body) ? arr(body) : isObj(body) && Array.isArray(body.shipments) ? arr(body.shipments) : isObj(body) ? [body] : []
  const relevant = records.filter(r => !(FLIPKART_MAP.ignoredEvents as readonly string[]).includes(String(r.eventType ?? '')))
  if (records.length && !relevant.length) return []
  const events = eventsFrom('flipkart', relevant.map(flipkartRecord), FLIPKART_MAP.push)
  // A polled shipment has no event id; its key changes only when Flipkart updates it.
  return source === 'poll' ? events.map(e => ({ ...e, key: eventKey('flipkart', 'poll', e.externalOrderId, pickStr(e.payload, ['updatedAt']), JSON.stringify(pickArr(e.payload, ['orderItems']).map(i => pick(i, ['status'])))) })) : events
}

const shipmentResult = (res: unknown, shipmentId: string) => {
  const rows = pickArr(res, ['shipments'])
  return rows.find(r => pickStr(r, ['shipmentId']) === shipmentId) ?? rows[0] ?? null
}

/** The Flipkart adapter for a store's sandbox or live credentials. */
export function flipkartAdapter(creds: Pick<MarketplaceCreds, 'mode' | 'fields' | 'endpoints'>): MarketplaceAdapter {
  const mode = creds.mode === 'sandbox' ? 'sandbox' : 'live'
  const f = creds.fields ?? {}
  const ep: ResolvedEndpoints = resolveEndpoints('flipkart', creds)
  const locationId = f.location_id ?? ''
  const tokenKey = `flipkart:${ep.base}:${f.app_id ?? ''}`

  const getToken = (force: boolean) =>
    cachedToken(
      tokenKey,
      async () => {
        const basic = Buffer.from(`${f.app_id ?? ''}:${f.app_secret ?? ''}`).toString('base64')
        const res = await marketplaceJson({
          url: `${endpointUrl(ep, 'token')}?grant_type=client_credentials&scope=Seller_Api`,
          headers: { Authorization: `Basic ${basic}` },
          timeoutMs: 20_000,
        })
        const token = pickStr(res, ['access_token'])
        if (!token) throw new MarketplaceApiError('Flipkart returned no access token', 200, '')
        return { token, expiresInSecs: pickNum(res, ['expires_in']) ?? ep.tokenTtlSecs }
      },
      force
    )

  const base = { auth: { getToken, header: ep.headers.auth, scheme: ep.headers.authScheme }, paceKey: tokenKey, perSecond: ep.rateLimit.perSecond }
  const post = (url: string, body: unknown) => marketplaceJson({ ...base, url, method: 'POST', body })
  const action = (name: string) => endpointUrl(ep, 'orderAction', { action: name })

  const pdf = async (url: string, method: 'GET' | 'POST', filename: string, body?: unknown) => {
    const res = await marketplaceRequest({ ...base, url, method, body, headers: { Accept: 'application/pdf, application/octet-stream, application/json' } })
    return readDocument(res, filename, { base64: ['data', 'pdf'], url: ['url', 'downloadUrl'] })
  }

  const document = async (kind: DocumentKind, externalOrderId: string, ref?: string) => {
    if (kind === 'manifest') return pdf(endpointUrl(ep, 'manifest'), 'POST', `flipkart-manifest-${ref ?? 'today'}.pdf`, { locationId, isMps: false })
    // The labels call returns the shipping label and the tax invoice in one PDF.
    const shipmentId = ref ?? externalOrderId
    return pdf(endpointUrl(ep, kind, { packetId: shipmentId }), 'GET', `flipkart-${kind}-${shipmentId}.pdf`)
  }

  /** product_id (FSN) per SKU, which Flipkart's listing calls key on. */
  const productIds = async (skus: string[]): Promise<Map<string, string>> => {
    const res = await post(endpointUrl(ep, 'listingTask'), { sku_ids: skus })
    const found = new Map<string, string>()
    const available = isObj(res?.available) ? res.available : isObj(res) ? res : {}
    for (const sku of skus) {
      const id = pickStr(available[sku], ['product_id', 'productId'])
      if (id) found.set(sku, id)
    }
    return found
  }

  const listingBody = (rows: ListingRow[]) => {
    const body: Obj = {}
    for (const r of rows) {
      const a = r.attributes
      const n = (keys: string[]) => pickNum(a, keys)
      const s = (keys: string[]) => pickStr(a, keys)
      body[r.sku] = {
        product_id: r.styleId ?? s(['product_id', 'fsn', 'FSN']),
        price: { mrp: n(['mrp', 'MRP']), selling_price: n(['selling_price', 'sellingPrice', 'price']), currency: 'INR' },
        tax: { hsn: s(['hsn', 'HSN', 'hsn_code']), tax_code: s(['tax_code', 'gst_rate', 'GST']) },
        listing_status: 'ACTIVE',
        fulfillment: { dispatch_sla: n(['dispatch_sla', 'procurement_sla']) ?? 2, shipping_provider: 'FLIPKART', procurement_type: 'REGULAR' },
        packages: [
          {
            name: 'package-1',
            dimensions: { length: n(['length', 'package_length']), breadth: n(['breadth', 'width', 'package_breadth']), height: n(['height', 'package_height']) },
            weight: n(['weight', 'package_weight']),
          },
        ],
        locations: [{ id: locationId, status: 'ENABLED', inventory: Math.max(0, Math.round(n(['inventory', 'quantity', 'stock']) ?? 0)) }],
      }
    }
    return body
  }

  return {
    channel: 'flipkart',
    mode,
    async test() {
      if (!f.app_id || !f.app_secret || !locationId) return { ok: false, message: 'Enter the Application ID, Application Secret and Location ID.' }
      try {
        await getToken(true)
        return { ok: true, message: 'Flipkart accepted the credentials.' }
      } catch (e) {
        const status = e instanceof MarketplaceApiError ? e.status : 0
        return { ok: false, message: status === 400 || status === 401 || status === 403 ? 'Flipkart rejected the Application ID or Secret.' : `Could not reach Flipkart: ${(e as Error).message}` }
      }
    },
    verifyPush(input) {
      return flipkartSignatureValid(input, f)
    },
    parsePush(body) {
      return flipkartEvents(body, 'push')
    },
    normalize(event) {
      return normalizeRecord('flipkart', FLIPKART_MAP.push, event.payload, event)
    },
    async ack() {},
    async pollOrders(since) {
      const from = since.toISOString()
      const to = new Date().toISOString()
      const filters = [
        { type: 'preDispatch', states: ['APPROVED', 'PACKED', 'READY_TO_DISPATCH'], orderDate: { from, to } },
        { type: 'cancelled', states: ['CANCELLED'], cancellationDate: { from, to } },
      ]
      const events: PushEvent[] = []
      for (const filter of filters) {
        let res: any = await post(`${ep.base}${FLIPKART_MAP.paths.shipments}/filter/`, { filter, pagination: { pageSize: 20 }, sort: { field: 'orderDate', order: 'desc' } })
        for (let page = 0; page < FLIPKART_MAP.pollPages; page++) {
          events.push(...flipkartEvents(arr(res?.shipments), 'poll'))
          const next = pickStr(res, ['nextPageUrl'])
          if (!res?.hasMore || !next) break
          const url = next.startsWith('https://') ? next : `${ep.base}${next.startsWith('/sellers') ? '' : '/sellers'}${next}`
          if (!url.startsWith(`${ep.base}/`)) break
          res = await marketplaceJson({ ...base, url })
        }
      }
      return events
    },
    async pushInventory(updates) {
      const out: InventoryResult[] = []
      for (const batch of chunk(updates, ep.batch.inventory)) {
        try {
          const ids = await productIds(batch.map(r => r.sku))
          const body: Obj = {}
          for (const r of batch) {
            const productId = ids.get(r.sku)
            if (!productId) out.push({ sku: r.sku, warehouseId: r.warehouseId ?? locationId, ok: false, error: 'Not listed on Flipkart' })
            else body[r.sku] = { product_id: productId, locations: [{ id: r.warehouseId ?? locationId, inventory: Math.max(0, r.quantity) }] }
          }
          if (!Object.keys(body).length) continue
          const res = await post(endpointUrl(ep, 'inventory'), body)
          for (const sku of Object.keys(body)) {
            const hit = isObj(res) ? res[sku] : null
            const ok = !hit || pickStr(hit, ['status']) !== 'FAILURE'
            const err = ok ? undefined : pickArr(hit, ['errors']).map(e => pickStr(e, ['description', 'message']) ?? '').filter(Boolean).join('; ') || 'Rejected by Flipkart'
            out.push({ sku, warehouseId: body[sku].locations[0].id, ok, error: err })
          }
        } catch (e) {
          for (const r of batch) if (!out.some(o => o.sku === r.sku)) out.push({ sku: r.sku, warehouseId: r.warehouseId ?? locationId, ok: false, error: (e as Error).message })
        }
      }
      return out
    },
    async orderAction(input: OrderActionInput): Promise<OrderActionResult> {
      const id = input.externalOrderId
      if (input.action === 'accept') return { ok: true, status: 'accepted', message: 'Flipkart orders arrive approved.' }
      let res: any
      if (input.action === 'pack') {
        res = await post(action('labels'), { shipments: [{ shipmentId: id, locationId }] })
      } else if (input.action === 'ready_to_dispatch') {
        res = await post(action('dispatch'), { shipmentIds: [id], locationId })
      } else {
        const reason = FLIPKART_MAP.cancelReasons.find(r => r === input.reason) ?? 'not_enough_inventory'
        res = await post(action('cancel'), { shipments: [{ shipmentId: id, locationId, reason }] })
      }
      const row = shipmentResult(res, id)
      const failed = pickStr(row, ['processingStatus', 'status']) === 'FAILURE' || !!pickStr(row, ['errorCode'])
      return {
        ok: !failed,
        status: ACTION_STATUS[input.action],
        shipment: input.action === 'pack' ? { packetId: id, lineIds: input.lineIds ?? [] } : null,
        message: pickStr(row, ['errorMessage', 'message']) ?? (input.action === 'pack' ? 'Flipkart is generating the label and invoice; it can take a few minutes.' : undefined),
        raw: res,
      }
    },
    document,
    async createManifest() {
      const manifestId = `FKM-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`
      const doc = await document('manifest', '', manifestId)
      return { manifestId, document: doc }
    },
    async submitListings(rows) {
      if (rows.length > ep.batch.listings) throw new Error(`Flipkart takes at most ${ep.batch.listings} listings per call.`)
      const missing = rows.filter(r => !r.styleId && !pickStr(r.attributes, ['product_id', 'fsn', 'FSN']))
      if (missing.length) throw new Error(`Flipkart lists against an existing FSN (product_id); add it for ${missing.map(r => r.sku).join(', ')}.`)
      const res = await post(endpointUrl(ep, 'listings'), listingBody(rows))
      const failures = rows
        .map(r => ({ sku: r.sku, hit: isObj(res) ? res[r.sku] : null }))
        .filter(x => pickStr(x.hit, ['status']) === 'FAILURE')
      if (failures.length === rows.length) {
        const text = failures.map(x => `${x.sku}: ${pickArr(x.hit, ['errors']).map(e => pickStr(e, ['description', 'message'])).filter(Boolean).join('; ') || 'rejected'}`).join(' | ')
        throw new MarketplaceApiError(`Flipkart rejected every listing: ${text}`.slice(0, 1000), 400, JSON.stringify(res ?? {}).slice(0, 2000))
      }
      return { taskId: `fk:${rows.map(r => r.sku).join(',')}` }
    },
    async listingTask(taskId): Promise<ListingTaskResult> {
      const skus = taskId.replace(/^fk:/, '').split(',').filter(Boolean)
      const res = await post(endpointUrl(ep, 'listingTask'), { sku_ids: skus })
      const available = isObj(res?.available) ? res.available : {}
      const rows = skus.map(sku => {
        const hit = available[sku]
        const state = pickStr(hit, ['listing_status'])
        const ok = !!hit && state !== 'INACTIVE'
        return { sku, ok, listingRef: pickStr(hit, ['listing_id', 'product_id']), issues: ok ? [] : [hit ? `Listing is ${state}` : 'Not listed on Flipkart'] }
      })
      const okCount = rows.filter(r => r.ok).length
      return { taskId, status: okCount === rows.length ? 'done' : okCount ? 'partial' : 'failed', rows, raw: res }
    },
    async returnAction(input: ReturnActionInput) {
      if (input.action !== 'receive') return { ok: false, message: 'Flipkart has no QC call in its API; raise a QC claim in Seller Hub.' }
      const res = await post(endpointUrl(ep, 'returns', { action: 'complete' }), { locationId, returnIds: [input.externalReturnId] })
      const row = pickArr(res, ['returns', 'returnItems'])[0]
      const failed = pickStr(row, ['status']) === 'FAILURE'
      return { ok: !failed, message: pickStr(row, ['errorMessage', 'message']) ?? undefined, raw: res }
    },
  }
}
