import type { MarketplaceCreds } from '@/lib/integrations/resolve'
import type { DocumentKind, InventoryResult, InventoryUpdate, InvoiceUpload, MarketplaceAdapter, OrderActionInput, OrderActionResult, ReturnActionInput } from './adapter'
import { endpointUrl, resolveEndpoints, type ResolvedEndpoints } from './endpoints'
import { MarketplaceApiError, cachedToken, marketplaceJson, marketplaceRequest } from './http'
import { ACTION_STATUS, chunk, eventsFrom, normalizeRecord, pick, pickArr, pickNum, pickStr, readDocument, statusFrom, type PushMap } from './mapping'

// AJIO VMS APIs (dropship, B2B2C). Login is seller ID + password, scoped to the POB ("DV…"). AJIO
// raises a B2B purchase order when an order is packed; we invoice AJIO for it. The B2C invoice,
// label and manifest (at most `batch.manifest` packets) come from AJIO. Addresses, header names and
// batch sizes come from endpoints.ts; field names, codes and event names live in AJIO_MAP.

// confirm against partner docs: every key, code and event name in this object.
export const AJIO_MAP = {
  push: {
    list: ['orders', 'data', 'shipments'],
    eventId: ['eventId', 'messageId', 'event_id'],
    eventType: ['eventType', 'event'],
    orderId: ['orderId', 'customerOrderId', 'orderNumber'],
    status: ['orderStatus', 'status'],
    eventAt: ['eventTime', 'updatedAt', 'statusUpdatedOn'],
    placedAt: ['orderDate', 'createdAt', 'orderCreatedOn'],
    acceptBy: ['acceptBy', 'confirmBy', 'slaConfirmBy'],
    dispatchBy: ['dispatchBy', 'shipBy', 'slaShipBy'],
    total: ['orderTotal', 'totalAmount', 'netAmount'],
    invoiceRef: ['customerInvoiceNumber', 'b2cInvoiceNumber', 'invoiceNumber'],
    city: ['shippingAddress.city', 'deliveryAddress.city', 'city'],
    state: ['shippingAddress.state', 'deliveryAddress.state', 'state'],
    postalCode: ['shippingAddress.pincode', 'deliveryAddress.pincode', 'pincode'],
    lines: ['orderLines', 'items', 'lineItems'],
    packetId: ['shipmentId', 'packetId', 'packageId'],
    tracking: ['awbNumber', 'trackingNumber'],
    courier: ['courierName', 'courier', 'logisticsPartner'],
    trackingUrl: ['trackingUrl'],
    manifestId: ['manifestId', 'manifestNumber'],
    line: {
      id: ['orderLineId', 'lineId', 'itemId'],
      sku: ['sellerSku', 'skuCode', 'sku', 'ean'],
      styleId: ['styleCode', 'styleId'],
      title: ['productName', 'title', 'description'],
      size: ['size'],
      colour: ['colour', 'color'],
      quantity: ['quantity', 'qty'],
      price: ['sellingPrice', 'unitPrice', 'price'],
      tax: ['taxAmount', 'tax'],
      mrp: ['mrp'],
      status: ['status', 'lineStatus'],
    },
    return: {
      id: ['returnId', 'return.returnId', 'rtoId'],
      type: ['returnType', 'return.type'],
      status: ['returnStatus', 'return.status'],
      reason: ['returnReason', 'return.reason'],
      lineIds: ['returnLineIds', 'return.lineIds'],
      refund: ['refundAmount', 'return.refundAmount'],
      tracking: ['returnAwbNumber', 'return.awbNumber'],
    },
    po: {
      number: ['poNumber', 'purchaseOrder.poNumber', 'po.number'],
      date: ['poDate', 'purchaseOrder.poDate', 'po.date'],
      amount: ['poAmount', 'purchaseOrder.poAmount', 'po.amount'],
      buyerGstin: ['buyerGstin', 'purchaseOrder.buyerGstin', 'billTo.gstin'],
      buyerName: ['buyerName', 'purchaseOrder.buyerName', 'billTo.name'],
    },
    statuses: {
      CREATED: 'created',
      NEW: 'created',
      PENDING: 'created',
      CONFIRMED: 'accepted',
      ACCEPTED: 'accepted',
      PACKED: 'packed',
      PO_CREATED: 'packed',
      READY_TO_SHIP: 'ready_to_dispatch',
      RTD: 'ready_to_dispatch',
      MANIFESTED: 'ready_to_dispatch',
      SHIPPED: 'shipped',
      DISPATCHED: 'shipped',
      IN_TRANSIT: 'shipped',
      DELIVERED: 'delivered',
      CANCELLED: 'cancelled',
      CANCELED: 'cancelled',
      REJECTED: 'rejected',
      RTO: 'returned',
      RTO_DELIVERED: 'returned',
      RETURNED: 'returned',
      RETURN_INITIATED: 'returned',
    },
    returnStatuses: {
      INITIATED: 'initiated',
      CREATED: 'initiated',
      PICKED_UP: 'in_transit',
      IN_TRANSIT: 'in_transit',
      RECEIVED: 'received',
      DELIVERED: 'received',
      CLOSED: 'closed',
      CANCELLED: 'cancelled',
    },
  } satisfies PushMap,
  pobHeader: 'x-pob-id',
  tokenBody: (f: Record<string, string>) => ({ sellerId: f.seller_id, password: f.password, pobId: f.pob_id }),
  token: { value: ['accessToken', 'access_token', 'token', 'data.token'], expiresIn: ['expiresIn', 'expires_in'] },
  events: { accept: 'CONFIRM', reject: 'REJECT', pack: 'PACK', ready_to_dispatch: 'READY_TO_SHIP', cancel: 'CANCEL' },
  actionBody: (input: OrderActionInput, event: string, pobId: string) => ({
    action: event,
    pobId,
    lineIds: input.lineIds ?? [],
    reason: input.reason ?? null,
    package: input.packet ?? null,
  }),
  actionResult: { ok: ['success'], status: ['orderStatus', 'status'], message: ['message', 'error'], packetId: ['shipmentId', 'packetId'], tracking: ['awbNumber', 'trackingNumber'], courier: ['courierName', 'courier'], trackingUrl: ['trackingUrl'] },
  inventoryBody: (rows: InventoryUpdate[], pobId: string) => ({ pobId, items: rows.map(r => ({ sellerSku: r.sku, quantity: r.quantity })) }),
  inventoryResult: { list: ['results', 'data'], sku: ['sellerSku', 'sku'], ok: ['success'], message: ['message', 'error'] },
  manifestBody: (packetIds: string[], pobId: string) => ({ pobId, shipmentIds: packetIds }),
  manifestResult: { id: ['manifestId', 'manifestNumber', 'data.manifestId'] },
  invoiceBody: (u: InvoiceUpload) => ({
    poNumber: u.poNumber,
    invoiceNumber: u.invoiceNumber,
    invoiceDate: u.invoiceDate,
    invoiceAmount: u.amount,
    invoicePdf: u.pdf ? u.pdf.toString('base64') : null,
  }),
  returnEvents: { receive: 'RECEIVED', qc_pass: 'QC_PASSED', qc_fail: 'QC_FAILED' },
  document: { base64: ['data', 'pdf', 'fileContent', 'content'], url: ['url', 'downloadUrl', 'fileUrl'] },
} as const

/** The AJIO adapter for a store's sandbox or live credentials. */
export function ajioAdapter(creds: Pick<MarketplaceCreds, 'mode' | 'fields' | 'endpoints'>): MarketplaceAdapter {
  const mode = creds.mode === 'sandbox' ? 'sandbox' : 'live'
  const f = creds.fields ?? {}
  const ep: ResolvedEndpoints = resolveEndpoints('ajio', creds)
  const pob = f.pob_id ?? ''
  const tokenKey = `ajio:${ep.base}:${f.seller_id ?? ''}:${pob}`

  const getToken = (force: boolean) =>
    cachedToken(
      tokenKey,
      async () => {
        const res = await marketplaceJson({ url: endpointUrl(ep, 'token'), method: 'POST', body: AJIO_MAP.tokenBody(f), timeoutMs: 20_000 })
        const token = pickStr(res, AJIO_MAP.token.value)
        if (!token) throw new MarketplaceApiError('AJIO returned no access token', 200, '')
        return { token, expiresInSecs: pickNum(res, AJIO_MAP.token.expiresIn) ?? ep.tokenTtlSecs }
      },
      force
    )

  const base = {
    headers: { [AJIO_MAP.pobHeader]: pob },
    auth: { getToken, header: ep.headers.auth, scheme: ep.headers.authScheme },
    paceKey: tokenKey,
    perSecond: ep.rateLimit.perSecond,
  }

  const document = async (kind: DocumentKind, externalOrderId: string, ref?: string) => {
    if (kind === 'manifest' && !ref) throw new Error('This order has no manifest yet.')
    const url =
      kind === 'manifest'
        ? endpointUrl(ep, 'manifestDocument', { manifestId: ref! })
        : endpointUrl(ep, kind, { orderId: externalOrderId, packetId: ref ?? externalOrderId })
    const res = await marketplaceRequest({ ...base, url, headers: { ...base.headers, Accept: 'application/pdf, application/json' } })
    return readDocument(res, `ajio-${kind}-${ref ?? externalOrderId}.pdf`, AJIO_MAP.document)
  }

  return {
    channel: 'ajio',
    mode,
    async test() {
      if (!f.seller_id || !f.password || !pob) return { ok: false, message: 'Enter the Seller ID, password and POB ID.' }
      try {
        await getToken(true)
        return { ok: true, message: 'AJIO accepted the credentials.' }
      } catch (e) {
        const status = e instanceof MarketplaceApiError ? e.status : 0
        return { ok: false, message: status === 401 || status === 403 ? 'AJIO rejected the Seller ID, password or POB ID.' : `Could not reach AJIO: ${(e as Error).message}` }
      }
    },
    parsePush(body) {
      return eventsFrom('ajio', body, AJIO_MAP.push)
    },
    normalize(event) {
      return normalizeRecord('ajio', AJIO_MAP.push, event.payload, event)
    },
    async ack(ids) {
      if (!ids.length) return
      await marketplaceRequest({ ...base, url: endpointUrl(ep, 'ack'), method: 'POST', body: { pobId: pob, orderIds: ids } })
    },
    async pushInventory(updates) {
      const out: InventoryResult[] = []
      for (const batch of chunk(updates, ep.batch.inventory)) {
        try {
          const res = await marketplaceJson({ ...base, url: endpointUrl(ep, 'inventory'), method: 'POST', body: AJIO_MAP.inventoryBody(batch, pob) })
          const results = pickArr(res, AJIO_MAP.inventoryResult.list)
          for (const r of batch) {
            const hit = results.find(x => pickStr(x, AJIO_MAP.inventoryResult.sku) === r.sku)
            const ok = !hit || pick(hit, AJIO_MAP.inventoryResult.ok) !== false
            out.push({ sku: r.sku, warehouseId: r.warehouseId ?? pob, ok, error: ok ? undefined : pickStr(hit, AJIO_MAP.inventoryResult.message) ?? 'Rejected by AJIO' })
          }
        } catch (e) {
          for (const r of batch) out.push({ sku: r.sku, warehouseId: r.warehouseId ?? pob, ok: false, error: (e as Error).message })
        }
      }
      return out
    },
    async orderAction(input): Promise<OrderActionResult> {
      const res = await marketplaceJson({
        ...base,
        url: endpointUrl(ep, 'orderAction', { orderId: input.externalOrderId }),
        method: 'POST',
        body: AJIO_MAP.actionBody(input, AJIO_MAP.events[input.action], pob),
      })
      const m = AJIO_MAP.actionResult
      const packetId = pickStr(res, m.packetId)
      const trackingNumber = pickStr(res, m.tracking)
      return {
        ok: pick(res, m.ok) !== false,
        status: statusFrom(AJIO_MAP.push.statuses, pickStr(res, m.status)) ?? ACTION_STATUS[input.action],
        shipment: packetId || trackingNumber ? { packetId, trackingNumber, courier: pickStr(res, m.courier), trackingUrl: pickStr(res, m.trackingUrl), lineIds: input.lineIds ?? [] } : null,
        message: pickStr(res, m.message) ?? undefined,
        raw: res,
      }
    },
    document,
    async createManifest(packetIds) {
      if (!packetIds.length) throw new Error('Pick at least one packet.')
      if (packetIds.length > ep.batch.manifest) throw new Error(`A manifest takes at most ${ep.batch.manifest} packets.`)
      const res = await marketplaceJson({ ...base, url: endpointUrl(ep, 'manifest'), method: 'POST', body: AJIO_MAP.manifestBody(packetIds, pob) })
      const manifestId = pickStr(res, AJIO_MAP.manifestResult.id)
      if (!manifestId) throw new MarketplaceApiError('AJIO returned no manifest id', 200, JSON.stringify(res ?? {}).slice(0, 500))
      const doc = await document('manifest', '', manifestId).catch(() => undefined)
      return { manifestId, document: doc }
    },
    async returnAction(input: ReturnActionInput) {
      const res = await marketplaceJson({
        ...base,
        url: endpointUrl(ep, 'returns', { returnId: input.externalReturnId }),
        method: 'POST',
        body: { action: AJIO_MAP.returnEvents[input.action], pobId: pob, remarks: input.note ?? null },
      })
      return { ok: pick(res, ['success']) !== false, message: pickStr(res, ['message']) ?? undefined, raw: res }
    },
    // Not called yet: wired once the partner docs confirm AJIO wants our B2B invoice uploaded.
    async uploadInvoice(u) {
      const res = await marketplaceJson({ ...base, url: endpointUrl(ep, 'invoiceUpload', { orderId: u.externalOrderId }), method: 'POST', body: AJIO_MAP.invoiceBody(u) })
      return { ok: pick(res, ['success']) !== false, message: pickStr(res, ['message']) ?? undefined }
    },
  }
}
