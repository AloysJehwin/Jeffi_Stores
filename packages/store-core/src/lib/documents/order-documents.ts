import 'server-only'
import { NextResponse } from 'next/server'
import { PDFDocument } from 'pdf-lib'
import { queryMany } from '@/lib/shared/db'
import { hasScope } from '@/lib/auth/scopes'
import type { AdminJWTPayload } from '@/lib/auth/jwt'
import { resolveDelhiveryToken } from '@/lib/integrations/resolve'
import { docServiceFetch } from '@/lib/documents/proxy'
import { generatePackingSlipPDF, loadStoreSettings, type PackingSlipOrder } from '@/lib/documents/packing-slip-pdf'
import { buildLabelPDF, type LabelItem } from '@/lib/documents/shipping-label-pdf'
import { fetchDelhiveryA4Label, fetchDelhiveryPackages } from '@/lib/documents/delhivery-label'
import { orderItemFactorSql, orderItemUnitSql } from '@/lib/orders/unit-conversion'

/** Page order within one order's set. */
export const ORDER_DOCS = ['invoice', 'packing_slip', 'label'] as const
export type OrderDoc = (typeof ORDER_DOCS)[number]
export type LabelSize = '4x6' | 'a4'
export type SkippedDocs = Record<OrderDoc, string[]>

export const MAX_DOCUMENT_ORDERS = 100
const DOC_SCOPE: Record<OrderDoc, string> = { invoice: 'orders:read', packing_slip: 'packing_slips:read', label: 'orders:read' }

export class NothingToDownload extends Error {}

export function parseDocs(input: unknown): OrderDoc[] {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(',')
  const wanted = new Set(raw.map(d => String(d).trim()))
  return ORDER_DOCS.filter(d => wanted.has(d))
}

export function parseLabelSize(input: unknown): LabelSize {
  return input === 'a4' ? 'a4' : '4x6'
}

/** The first requested document this admin may not download, if any. */
export function missingDocScope(admin: AdminJWTPayload, docs: OrderDoc[]): OrderDoc | null {
  return docs.find(d => !hasScope(admin.role, admin.scopes, DOC_SCOPE[d])) ?? null
}

type DocOrder = PackingSlipOrder & {
  awb_number: string | null
  invoice_number: string | null
  payment_mode: string | null
  payment_status: string | null
  digital_item_count: number
}

// Same rows the single packing slip route renders, plus what the label and invoice need.
async function loadOrders(ids: string[]): Promise<DocOrder[]> {
  const rows = await queryMany<any>(
    `SELECT o.id, o.order_number, o.created_at, o.customer_name, o.customer_phone,
            o.total_amount, o.discount_amount, o.business_discount_amount, o.shipping_amount,
            o.taxable_amount, o.cgst_amount, o.sgst_amount, o.igst_amount, o.is_igst,
            o.awb_number, o.invoice_number, o.payment_mode, o.payment_status,
            (SELECT COUNT(*) FROM order_items d WHERE d.order_id = o.id AND d.is_digital)::int AS digital_item_count,
            row_to_json(a) AS shipping_address,
            json_agg(json_build_object(
              'product_name', COALESCE(oi.product_name, p.name, 'Product'),
              'variant_name', oi.variant_name,
              'quantity', oi.quantity,
              'buy_mode', oi.buy_mode,
              'buy_unit', oi.buy_unit,
              'sell_unit', ${orderItemUnitSql()},
              'sell_unit_factor', ${orderItemFactorSql()},
              'unit_price', oi.unit_price,
              'total_price', oi.total_price,
              'mrp', oi.mrp,
              'discount_amount', oi.discount_amount,
              'hsn_code', COALESCE(oi.hsn_code, p.hsn_code),
              'gst_rate', COALESCE(oi.gst_rate, p.gst_percentage, 0),
              'taxable_amount', oi.taxable_amount,
              'cgst_amount', oi.cgst_amount,
              'sgst_amount', oi.sgst_amount,
              'igst_amount', oi.igst_amount,
              'image_url', pi.thumbnail_url
            ) ORDER BY oi.created_at) AS items
     FROM orders o
     LEFT JOIN addresses a ON a.id = o.shipping_address_id
     LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.is_digital IS NOT TRUE
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = true
     WHERE o.id = ANY($1::uuid[])
     GROUP BY o.id, a.id`,
    [ids]
  )
  const byId = new Map((rows || []).map(r => [r.id, { ...r, items: (r.items || []).filter(Boolean) }]))
  return ids.map(id => byId.get(id)).filter(Boolean) as DocOrder[]
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

const isPdf = (bytes: Uint8Array) => bytes.length > 4 && Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-'

async function fetchInvoice(orderId: string, admin: AdminJWTPayload): Promise<Uint8Array | null> {
  // Reads the issued invoice only: a 404 means the order has no invoice number yet.
  const res = await docServiceFetch(`/orders/${orderId}/invoice`, {
    adminId: admin.adminId,
    role: admin.role,
    scopes: admin.scopes,
  })
  if (!res.ok) return null
  const bytes = new Uint8Array(await res.arrayBuffer())
  return isPdf(bytes) ? bytes : null
}

function labelItems(order: DocOrder): LabelItem[] {
  return order.items.map(it => ({
    name: [it.product_name, it.variant_name].filter(Boolean).join(' — '),
    qty: Number(it.quantity) || 1,
    price: Number(it.unit_price) || 0,
    total: Number(it.total_price) || 0,
  }))
}

// Without Delhivery's package data the label still prints, with the COD amount when it's due.
function fallbackPackage(order: DocOrder) {
  const cod = String(order.payment_mode || '').toLowerCase().includes('cod') && order.payment_status !== 'paid'
  return cod ? { cod: String(order.total_amount ?? '0') } : {}
}

export interface OrderDocumentsResult {
  pdf: Uint8Array
  skipped: SkippedDocs
  orderNumbers: string[]
}

/**
 * One PDF of the chosen documents for each order, grouped per order in `orderIds` order:
 * invoice, packing slip, then shipping label. A document an order doesn't have yet is left out
 * and listed in `skipped`. Returns null when none of the orders exist.
 */
export async function buildOrderDocuments({
  orderIds,
  docs,
  labelSize,
  admin,
}: {
  orderIds: string[]
  docs: OrderDoc[]
  labelSize: LabelSize
  admin: AdminJWTPayload
}): Promise<OrderDocumentsResult | null> {
  const orders = await loadOrders(orderIds)
  if (orders.length === 0) return null

  const want = new Set(docs)
  const skipped: SkippedDocs = { invoice: [], packing_slip: [], label: [] }
  const store = want.has('packing_slip') ? await loadStoreSettings() : null
  const shipped = want.has('label') ? orders.filter(o => o.awb_number) : []
  const token = shipped.length ? await resolveDelhiveryToken().catch(() => '') : ''

  let packages = new Map<string, any>()
  if (labelSize === '4x6' && token && shipped.length) {
    for (let i = 0; i < shipped.length; i += 25) {
      const batch = shipped.slice(i, i + 25).map(o => o.awb_number!)
      const found = await fetchDelhiveryPackages(batch, token).catch(() => new Map<string, any>())
      packages = new Map([...packages, ...found])
    }
  }

  const parts = await mapLimit(orders, 4, async order => {
    const out: Uint8Array[] = []
    for (const doc of ORDER_DOCS) {
      if (!want.has(doc)) continue
      let bytes: Uint8Array | null = null
      if (doc === 'invoice') {
        bytes = order.invoice_number ? await fetchInvoice(order.id, admin).catch(() => null) : null
      } else if (doc === 'packing_slip') {
        if (order.items.length > 0 || order.digital_item_count === 0)
          bytes = await generatePackingSlipPDF(order, store!)
      } else if (order.awb_number) {
        if (labelSize === 'a4') {
          if (token)
            bytes = await fetchDelhiveryA4Label(order.awb_number, token)
              .then(b => new Uint8Array(b))
              .catch(() => null)
        } else {
          const row = {
            ...(order.shipping_address || {}),
            order_number: order.order_number,
            awb_number: order.awb_number,
            total_amount: order.total_amount,
          }
          const pkg = packages.get(order.awb_number) ?? fallbackPackage(order)
          bytes = await buildLabelPDF(pkg, order.awb_number, row, labelItems(order))
        }
      }
      if (bytes) out.push(bytes)
      else skipped[doc].push(order.order_number)
    }
    return out
  })

  const merged = await PDFDocument.create()
  for (const bytes of parts.flat()) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true }).catch(() => null)
    if (!src) continue
    for (const page of await merged.copyPages(src, src.getPageIndices())) merged.addPage(page)
  }
  if (merged.getPageCount() === 0) throw new NothingToDownload(nothingMessage(docs, orders.length))

  return { pdf: await merged.save(), skipped, orderNumbers: orders.map(o => o.order_number) }
}

const DOC_LABEL: Record<OrderDoc, string> = { invoice: 'invoice', packing_slip: 'packing slip', label: 'shipping label' }

function nothingMessage(docs: OrderDoc[], count: number) {
  const what = docs.map(d => DOC_LABEL[d]).join(' or ')
  return `No ${what} available for ${count === 1 ? 'this order' : 'these orders'} yet.`
}

const DOC_FILE: Record<OrderDoc, string> = { invoice: 'invoice', packing_slip: 'packing-slip', label: 'shipping-label' }

export function documentsFilename(docs: OrderDoc[], orderNumbers: string[]): string {
  const what = docs.length === 1 ? DOC_FILE[docs[0]] : 'documents'
  return orderNumbers.length === 1
    ? `${what}-${orderNumbers[0]}.pdf`
    : `order-${what}-${new Date().toISOString().slice(0, 10)}.pdf`
}

/** The PDF, with what was left out in `X-Documents-Skipped` (ASCII JSON) for the page's toast. */
export function documentsResponse(result: OrderDocumentsResult, filename: string, inline = false): NextResponse {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '-')
  return new NextResponse(result.pdf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safe}"`,
      'Content-Length': String(result.pdf.byteLength),
      'X-Documents-Skipped': JSON.stringify(result.skipped).replace(/[^\x20-\x7E]/g, ''),
    },
  })
}
