import 'server-only'
import { queryMany, queryOne } from '@/lib/shared/db'
import { PHYSICAL_ITEMS_SQL } from '@/lib/filters/entities/packing-slips'
import { DOC_FOLDERS, isDocFolder, type DocFolder, type DriveFile } from './types'

export { DOC_FOLDERS, isDocFolder, type DocFolder }

// The store's generated documents as read-only Drive sections. Nothing is stored twice: each PDF is
// rendered on demand by the route that already makes it, behind /api/admin/drive/documents.

interface DocRow {
  id: string
  number: string
  party: string | null
  amount: string | null
  at: string
  extra?: string | null
}

const inr = (n: string | null) => (n == null ? '' : `₹${Math.round(Number(n)).toLocaleString('en-IN')}`)

// Per section: the rows (id, number, party, amount, at, extra), the search columns, the file name and
// the record's admin page.
const SOURCES: Record<DocFolder, { from: string; select: string; search: string[]; file: (r: DocRow) => string; href: (r: DocRow) => string; meta?: (r: DocRow) => string }> = {
  invoices: {
    from: `orders o WHERE o.invoice_number IS NOT NULL`,
    select: `o.id::text, o.invoice_number AS number, o.customer_name AS party, o.total_amount::text AS amount, COALESCE(o.invoice_date::timestamptz, o.created_at) AS at`,
    search: ['o.invoice_number', 'o.order_number', 'o.customer_name'],
    file: r => `${r.number}.pdf`,
    href: r => `/admin/invoices/${r.id}/view`,
  },
  'cash-sales': {
    from: `cash_sales o WHERE true`,
    select: `o.id::text, COALESCE(o.invoice_number, o.sale_number) AS number, o.customer_name AS party, o.total_amount::text AS amount, COALESCE(o.invoice_date::timestamptz, o.created_at) AS at`,
    search: ['o.invoice_number', 'o.sale_number', 'o.customer_name'],
    file: r => `receipt-${r.number}.pdf`,
    href: r => `/admin/cash-sale/${r.id}/view`,
  },
  quotations: {
    from: `quotations o WHERE true`,
    select: `o.id::text, o.quote_number AS number, o.buyer_name AS party, o.total_amount::text AS amount, COALESCE(o.quote_date::timestamptz, o.created_at) AS at`,
    search: ['o.quote_number', 'o.buyer_name'],
    file: r => `quotation-${r.number}.pdf`,
    href: r => `/admin/quotations/${r.id}/view`,
  },
  'purchase-orders': {
    from: `purchase_orders o LEFT JOIN suppliers s ON s.id = o.supplier_id WHERE o.view_token IS NOT NULL`,
    select: `o.id::text, o.po_number AS number, s.name AS party, o.total_amount::text AS amount, COALESCE(o.order_date::timestamptz, o.created_at) AS at`,
    search: ['o.po_number', 's.name'],
    file: r => `po-${r.number}.pdf`,
    href: () => '/admin/purchase-orders',
  },
  'packing-slips': {
    from: `orders o WHERE o.status IS DISTINCT FROM 'draft' AND ${PHYSICAL_ITEMS_SQL}`,
    select: `o.id::text, o.order_number AS number, o.customer_name AS party, o.total_amount::text AS amount, o.created_at AS at`,
    search: ['o.order_number', 'o.customer_name'],
    file: r => `packing-slip-${r.number}.pdf`,
    href: r => `/admin/orders/${r.id}/view`,
  },
  'shipping-labels': {
    from: `orders o WHERE o.awb_number IS NOT NULL`,
    select: `o.id::text, o.order_number AS number, o.customer_name AS party, NULL::text AS amount, COALESCE(o.shipped_at, o.updated_at, o.created_at) AS at, o.awb_number AS extra`,
    search: ['o.order_number', 'o.awb_number', 'o.customer_name'],
    file: r => `label-${r.number}.pdf`,
    href: r => `/admin/orders/${r.id}/view`,
    meta: r => [r.party, r.extra && `AWB ${r.extra}`].filter(Boolean).join(' · '),
  },
}

export async function listDocuments(folder: DocFolder, o: { search?: string | null; limit: number; offset: number }): Promise<{ files: DriveFile[]; total: number }> {
  const src = SOURCES[folder]
  const q = o.search?.trim() ? `%${o.search.trim()}%` : null
  const where = q ? ` AND (${src.search.map(c => `${c} ILIKE $1`).join(' OR ')})` : ''
  const params = q ? [q] : []
  const [rows, n] = await Promise.all([
    queryMany<DocRow>(`SELECT ${src.select} FROM ${src.from}${where} ORDER BY at DESC LIMIT ${o.limit} OFFSET ${o.offset}`, params),
    queryOne<{ n: string }>(`SELECT count(*) AS n FROM ${src.from}${where}`, params),
  ])
  return { files: rows.map(r => toFile(folder, r)), total: Number(n?.n ?? 0) }
}

function toFile(folder: DocFolder, r: DocRow): DriveFile {
  const src = SOURCES[folder]
  const url = `/api/admin/drive/documents/${folder}/${r.id}`
  return {
    id: `${folder}:${r.id}`,
    folderId: folder,
    name: src.file(r).replace(/[/\\]/g, '-'),
    mime: 'application/pdf',
    kind: 'pdf',
    size: 0,
    width: null,
    height: null,
    duration: null,
    blurhash: null,
    source: 'document',
    createdAt: new Date(r.at).toISOString(),
    uploadedBy: r.party,
    url,
    thumbUrl: null,
    downloadUrl: `${url}?download=1`,
    access: 'view',
    meta: src.meta ? src.meta(r) : [r.party, inr(r.amount)].filter(Boolean).join(' · '),
    href: src.href(r),
  }
}
