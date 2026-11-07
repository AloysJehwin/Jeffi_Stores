import type { MarketplaceCreds } from '@/lib/integrations/resolve'
import type { DocumentKind, InventoryResult, InventoryUpdate, MarketplaceAdapter, OrderActionInput, OrderActionResult, ReturnActionInput } from './adapter'
import { endpointUrl, resolveEndpoints, type ResolvedEndpoints } from './endpoints'
import { MarketplaceApiError, cachedToken, marketplaceJson, marketplaceRequest } from './http'
import { ACTION_STATUS, chunk, eventsFrom, normalizeRecord, pick, pickArr, pickNum, pickStr, readDocument, statusFrom, type PushMap } from './mapping'

// Myntra PPMP / Omni API v4 (via MMIP). Addresses, header names and batch sizes come from
// endpoints.ts; field names, status codes and event names live in MYNTRA_MAP below.

// confirm against partner docs: every key, code and event name in this object.
export const MYNTRA_MAP = {
  push: {
    list: ['orders', 'orderReleases', 'data'],
    eventId: ['eventId', 'messageId', 'event_id'],
    eventType: ['eventType', 'event'],
    orderId: ['orderReleaseId', 'storeOrderId', 'orderId'],
    status: ['orderStatus', 'status'],
    eventAt: ['eventTime', 'lastModifiedOn', 'updatedOn', 'updatedAt'],
    placedAt: ['orderDate', 'createdOn', 'createdAt'],
    acceptBy: ['acceptBy', 'slaAcceptBy', 'acceptanceSla'],
    dispatchBy: ['dispatchBy', 'packBy', 'slaDispatchBy'],
    total: ['finalAmount', 'totalAmount', 'orderTotal'],
    invoiceRef: ['invoiceNumber', 'invoiceNo', 'invoice.number'],
    city: ['shippingAddress.city', 'address.city', 'city'],
    state: ['shippingAddress.state', 'address.state', 'state'],
    postalCode: ['shippingAddress.pincode', 'shippingAddress.zipcode', 'address.pincode', 'pincode'],
    lines: ['orderLines', 'lines', 'items'],
    packetId: ['packetId', 'packet.packetId'],
    tracking: ['trackingNumber', 'awbNumber', 'packet.trackingNumber'],
    courier: ['courierCode', 'courierName', 'packet.courierCode'],
    trackingUrl: ['trackingUrl', 'packet.trackingUrl'],
    manifestId: ['manifestId', 'packet.manifestId'],
    line: {
      id: ['orderLineId', 'lineId', 'id'],
      sku: ['sellerSkuCode', 'skuCode', 'sku'],
      styleId: ['styleId'],
      title: ['productName', 'styleName', 'title'],
      size: ['size', 'sizeLabel'],
      colour: ['colour', 'color', 'baseColour'],
      quantity: ['quantity', 'qty'],
      price: ['sellingPrice', 'finalAmount', 'unitPrice', 'price'],
      tax: ['taxAmount', 'tax'],
      mrp: ['mrp'],
      status: ['status', 'lineStatus', 'orderLineStatus'],
    },
    return: {
      id: ['returnId', 'return.returnId'],
      type: ['returnType', 'return.type'],
      status: ['returnStatus', 'return.status'],
      reason: ['returnReason', 'return.reason'],
      lineIds: ['returnLineIds', 'return.orderLineIds'],
      refund: ['refundAmount', 'return.refundAmount'],
      tracking: ['returnTrackingNumber', 'return.trackingNumber'],
    },
    statuses: {
      CREATED: 'created',
      NEW: 'created',
      Q: 'created',
      QUEUED: 'created',
      PLACED: 'created',
      ACCEPTED: 'accepted',
      CONFIRMED: 'accepted',
      WP: 'accepted',
      PK: 'packed',
      PACKED: 'packed',
      RFR: 'ready_to_dispatch',
      RTD: 'ready_to_dispatch',
      READY_TO_DISPATCH: 'ready_to_dispatch',
      READY_TO_SHIP: 'ready_to_dispatch',
      SH: 'shipped',
      SHIPPED: 'shipped',
      DISPATCHED: 'shipped',
      DL: 'delivered',
      DELIVERED: 'delivered',
      C: 'cancelled',
      F: 'cancelled',
      CANCELLED: 'cancelled',
      REJECTED: 'rejected',
      RTO: 'returned',
      RTO_DELIVERED: 'returned',
      RT: 'returned',
      RETURNED: 'returned',
    },
    returnStatuses: {
      INITIATED: 'initiated',
      CREATED: 'initiated',
      APPROVED: 'initiated',
      PICKED_UP: 'in_transit',
      IN_TRANSIT: 'in_transit',
      RECEIVED: 'received',
      DELIVERED_TO_SELLER: 'received',
      CLOSED: 'closed',
      CANCELLED: 'cancelled',
    },
  } satisfies PushMap,
  merchantHeader: 'x-merchant-id',
  tokenBody: (f: Record<string, string>) => ({ merchantId: f.merchant_id, secretKey: f.secret_key }),
  token: { value: ['accessToken', 'access_token', 'token'], expiresIn: ['expiresIn', 'expires_in'] },
  events: { accept: 'ACCEPT', reject: 'REJECT', pack: 'PACK', ready_to_dispatch: 'RTD', cancel: 'CANCEL' },
  actionBody: (input: OrderActionInput, event: string) => ({
    event,
    orderLineIds: input.lineIds ?? [],
    rejectionReason: input.reason ?? null,
    packetDetails: input.packet ?? null,
  }),
  actionResult: { ok: ['success'], status: ['orderStatus', 'status'], message: ['message', 'error'], packetId: ['packetId'], tracking: ['trackingNumber', 'awbNumber'], courier: ['courierCode', 'courierName'], trackingUrl: ['trackingUrl'] },
  inventoryBody: (rows: InventoryUpdate[]) => ({ inventory: rows.map(r => ({ warehouseId: r.warehouseId, sellerSkuCode: r.sku, quantity: r.quantity })) }),
  inventoryResult: { list: ['results', 'data'], sku: ['sellerSkuCode', 'skuCode', 'sku'], warehouse: ['warehouseId'], ok: ['success'], message: ['message', 'error'] },
  returnEvents: { receive: 'RECEIVED', qc_pass: 'QC_PASS', qc_fail: 'QC_FAIL' },
  document: { base64: ['data', 'pdf', 'fileContent', 'content'], url: ['url', 'downloadUrl', 'documentUrl'] },
} as const

const warehouses = (f: Record<string, string>) =>
  String(f.warehouse_ids ?? '')
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean)

/** The Myntra adapter for a store's sandbox or live credentials. */
export function myntraAdapter(creds: Pick<MarketplaceCreds, 'mode' | 'fields' | 'endpoints'>): MarketplaceAdapter {
  const mode = creds.mode === 'sandbox' ? 'sandbox' : 'live'
  const f = creds.fields ?? {}
  const ep: ResolvedEndpoints = resolveEndpoints('myntra', creds)
  const merchant = f.merchant_id ?? ''
  const tokenKey = `myntra:${ep.base}:${merchant}`

  const getToken = (force: boolean) =>
    cachedToken(
      tokenKey,
      async () => {
        const res = await marketplaceJson({ url: endpointUrl(ep, 'token'), method: 'POST', body: MYNTRA_MAP.tokenBody(f), timeoutMs: 20_000 })
        const token = pickStr(res, MYNTRA_MAP.token.value)
        if (!token) throw new MarketplaceApiError('Myntra returned no access token', 200, '')
        return { token, expiresInSecs: pickNum(res, MYNTRA_MAP.token.expiresIn) ?? ep.tokenTtlSecs }
      },
      force
    )

  const base = {
    headers: { [MYNTRA_MAP.merchantHeader]: merchant },
    auth: { getToken, header: ep.headers.auth, scheme: ep.headers.authScheme },
    paceKey: tokenKey,
    perSecond: ep.rateLimit.perSecond,
  }

  return {
    channel: 'myntra',
    mode,
    async test() {
      if (!merchant || !f.secret_key) return { ok: false, message: 'Enter the Merchant ID and Secret Key.' }
      try {
        await getToken(true)
        return { ok: true, message: 'Myntra accepted the credentials.' }
      } catch (e) {
        const status = e instanceof MarketplaceApiError ? e.status : 0
        return { ok: false, message: status === 401 || status === 403 ? 'Myntra rejected the Merchant ID or Secret Key.' : `Could not reach Myntra: ${(e as Error).message}` }
      }
    },
    parsePush(body) {
      return eventsFrom('myntra', body, MYNTRA_MAP.push)
    },
    normalize(event) {
      return normalizeRecord('myntra', MYNTRA_MAP.push, event.payload, event)
    },
    async ack(ids) {
      if (!ids.length) return
      await marketplaceRequest({ ...base, url: endpointUrl(ep, 'ack'), method: 'POST', body: { orderReleaseIds: ids } })
    },
    async pushInventory(updates) {
      const fallback = warehouses(f)[0] ?? null
      const rows = updates.map(u => ({ ...u, warehouseId: u.warehouseId ?? fallback }))
      const out: InventoryResult[] = []
      for (const batch of chunk(rows, ep.batch.inventory)) {
        try {
          const res = await marketplaceJson({ ...base, url: endpointUrl(ep, 'inventory'), method: 'POST', body: MYNTRA_MAP.inventoryBody(batch) })
          const results = pickArr(res, MYNTRA_MAP.inventoryResult.list)
          for (const r of batch) {
            const hit = results.find(x => pickStr(x, MYNTRA_MAP.inventoryResult.sku) === r.sku && (!r.warehouseId || (pickStr(x, MYNTRA_MAP.inventoryResult.warehouse) ?? r.warehouseId) === r.warehouseId))
            const ok = !hit || pick(hit, MYNTRA_MAP.inventoryResult.ok) !== false
            out.push({ sku: r.sku, warehouseId: r.warehouseId, ok, error: ok ? undefined : pickStr(hit, MYNTRA_MAP.inventoryResult.message) ?? 'Rejected by Myntra' })
          }
        } catch (e) {
          for (const r of batch) out.push({ sku: r.sku, warehouseId: r.warehouseId, ok: false, error: (e as Error).message })
        }
      }
      return out
    },
    async orderAction(input): Promise<OrderActionResult> {
      const res = await marketplaceJson({
        ...base,
        url: endpointUrl(ep, 'orderAction', { orderId: input.externalOrderId }),
        method: 'POST',
        body: MYNTRA_MAP.actionBody(input, MYNTRA_MAP.events[input.action]),
      })
      const m = MYNTRA_MAP.actionResult
      const ok = pick(res, m.ok) !== false
      const packetId = pickStr(res, m.packetId)
      const trackingNumber = pickStr(res, m.tracking)
      return {
        ok,
        status: statusFrom(MYNTRA_MAP.push.statuses, pickStr(res, m.status)) ?? ACTION_STATUS[input.action],
        shipment: packetId || trackingNumber ? { packetId, trackingNumber, courier: pickStr(res, m.courier), trackingUrl: pickStr(res, m.trackingUrl), lineIds: input.lineIds ?? [] } : null,
        message: pickStr(res, m.message) ?? undefined,
        raw: res,
      }
    },
    async document(kind: DocumentKind, externalOrderId, ref) {
      if (kind === 'manifest' && !ref) throw new Error('This order has no manifest yet.')
      const url =
        kind === 'manifest'
          ? endpointUrl(ep, 'manifestDocument', { manifestId: ref! })
          : endpointUrl(ep, kind, { orderId: externalOrderId, packetId: ref ?? externalOrderId })
      const res = await marketplaceRequest({ ...base, url, headers: { ...base.headers, Accept: 'application/pdf, application/json' } })
      return readDocument(res, `myntra-${kind}-${ref ?? externalOrderId}.pdf`, MYNTRA_MAP.document)
    },
    async returnAction(input: ReturnActionInput) {
      const res = await marketplaceJson({
        ...base,
        url: endpointUrl(ep, 'returns', { returnId: input.externalReturnId }),
        method: 'POST',
        body: { event: MYNTRA_MAP.returnEvents[input.action], remarks: input.note ?? null },
      })
      return { ok: pick(res, ['success']) !== false, message: pickStr(res, ['message']) ?? undefined, raw: res }
    },
  }
}
