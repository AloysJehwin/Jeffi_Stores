import { documentUrl } from '@/lib/shared/customer-links'
import { query, queryMany, queryOne } from '@/lib/shared/db'
import { round2 } from '@/lib/catalog/gst'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { productLabel } from '@/lib/catalog/product-label'
import { quotationLineRow, quotationLineSchema, quotationTotals, type QuotationLineInput } from '@/lib/documents/invoice-line-items'
import { VARIANT_MIN_PRICE_SQL } from '@/lib/queries'
import { unitChainsFor, asSellingUnit, type LineUnit } from '@/lib/catalog/unit-factor'
import { normUnit, validatePurchaseQuantity } from '@/lib/catalog/selling-unit'
import { embed, queryManyReplica, runWithHnswTuning } from '@/lib/shared/rag'
import { aiChat } from '@/lib/shared/ai-client'
import type { ToolDef } from '../tools'
import { ok, err } from '../tool-envelope'
import { ocrImage, ocrPdfPages } from '../vision'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

// ─── Signal agents (pure JS, run in parallel, no latency) ────────────────────

/** Agent 1: cosine similarity from embeddings (0–1) */
function embeddingSignal(sim: number): number {
  return clamp(sim, 0, 1)
}

/** Agent 2: Jaccard token overlap between query and product name (0–1) */
function tokenOverlapSignal(queryText: string, name: string): number {
  const tok = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
  const qToks = new Set(tok(queryText))
  const nToks = tok(name)
  if (!qToks.size || !nToks.length) return 0
  const hits = nToks.filter(t => qToks.has(t)).length
  return hits / Math.max(qToks.size, nToks.length)
}

/** Agent 3: exact match on spec numbers — dimensions, grades, standards (0 or 1) */
function specNumberSignal(queryText: string, name: string): number {
  // extract tokens that look like specs: M8, M20, DIN933, 48mm, 2.5mm², 8.8, 6013, 3.15, etc.
  const specRe =
    /\b(?:[mM]\d+|[dD][iI][nN]\s*\d+|[iI][sS][oO]\s*\d+|\d+(?:\.\d+)?(?:mm|cm|m|kg|kn|kw|hp|bar|psi|inch|"|')?\s*(?:x\s*\d+(?:\.\d+)?(?:mm|cm)?)?|\d+\.\d+)\b/g
  const qSpecs = new Set((queryText.match(specRe) || []).map(s => s.toLowerCase().replace(/\s+/g, '')))
  const nSpecs = new Set((name.match(specRe) || []).map(s => s.toLowerCase().replace(/\s+/g, '')))
  if (!qSpecs.size) return 0.5 // no specs in query — neutral, don't penalise
  const hits = [...qSpecs].filter(s => nSpecs.has(s)).length
  return hits / qSpecs.size
}

/** Agent 4: SKU fragment match — if query contains a SKU-like token that appears in the product SKU (0 or 1) */
function skuFragmentSignal(queryText: string, sku: string | null): number {
  if (!sku) return 0.5 // no SKU — neutral
  const skuNorm = sku.toLowerCase()
  const tokens = queryText
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3)
  return tokens.some(t => skuNorm.includes(t)) ? 1 : 0.5
}

/** Fast-path aggregator: weighted combination of the four JS signal agents */
function aggregateSignals(sim: number, tokenOverlap: number, specNum: number, skuFrag: number): number {
  const score = sim * 0.5 + tokenOverlap * 0.2 + specNum * 0.2 + skuFrag * 0.1
  return Math.round(clamp(score * 100, 0, 100))
}

/**
 * Haiku tiebreaker — only fires when top score is in the ambiguous range (45–89).
 * Returns a 0–100 score override, or null on failure (fallback to JS score).
 */
async function haikuTiebreakerScore(queryText: string, productName: string): Promise<number | null> {
  try {
    const r = await aiChat({
      modelHint: 'fast',
      jsonMode: false,
      temperature: 0,
      maxTokens: 16,
      messages: [
        {
          role: 'user',
          content: `Rate 0-100 how well the product name matches the search query. Reply with ONLY the integer number, nothing else.\nQuery: "${queryText}"\nProduct: "${productName}"`,
        },
      ],
    })
    const n = parseInt(r.content.trim(), 10)
    return isFinite(n) ? clamp(n, 0, 100) : null
  } catch {
    return null
  }
}
function fmtINR(n: number | string | null | undefined): string {
  const num = typeof n === 'number' ? n : Number(n || 0)
  if (!isFinite(num)) return '—'
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return String(d)
  }
}


const list_quotations: ToolDef = {
  name: 'list_quotations',
  description:
    'Recent quotations, optionally filtered by status (draft|final|cancelled), by customer (substring on consignee_name/email), or by days back. Returns quote_number, customer, total, status.',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', description: 'draft | final | cancelled' },
      customerId: {
        type: 'string',
        description:
          'Substring match on consignee_name or consignee_email — quotations are not strictly tied to a users.id, so this is a fuzzy filter.',
      },
      daysBack: { type: 'integer', default: 30, minimum: 1, maximum: 365 },
      limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
    },
  },
  mutating: false,
  handler: async ({ status, customerId, daysBack, limit }) => {
    const lim = clamp(typeof limit === 'number' ? limit : 20, 1, 100)
    const days = clamp(typeof daysBack === 'number' ? daysBack : 30, 1, 365)
    const params: unknown[] = [days]
    const where = [`q.created_at > NOW() - ($1 || ' days')::interval`]
    if (status) {
      params.push(String(status))
      where.push(`q.status = $${params.length}`)
    }
    if (customerId) {
      params.push(`%${String(customerId)}%`)
      where.push(`(q.consignee_name ILIKE $${params.length} OR q.consignee_email ILIKE $${params.length})`)
    }
    params.push(lim)
    const rows = await queryMany(
      `SELECT q.id::text, q.quote_number, q.quote_date, q.status,
              q.consignee_name, q.consignee_email,
              q.total_amount::text, q.converted_order_id::text,
              q.created_at
       FROM quotations q
       WHERE ${where.join(' AND ')}
       ORDER BY q.created_at DESC LIMIT $${params.length}`,
      params
    )
    return { quotations: rows, count: rows.length, truncated: rows.length === lim }
  },
}

const get_quotation: ToolDef = {
  name: 'get_quotation',
  description: 'Full quotation including line items and totals. Looks up by id or quote_number.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      quoteNumber: { type: 'string' },
    },
  },
  mutating: false,
  handler: async ({ id, quoteNumber }) => {
    if (!id && !quoteNumber) throw new Error('Provide id or quoteNumber')
    const q = await queryOne<any>(
      `SELECT id::text, quote_number, quote_date, status,
              consignee_name, consignee_email, consignee_phone, consignee_gstin,
              consignee_addr1, consignee_addr2, consignee_city, consignee_state, consignee_pincode,
              buyer_same, buyer_name, buyer_gstin, buyer_email,
              notes, subtotal::text, cgst_amount::text, sgst_amount::text, total_amount::text,
              converted_order_id::text, view_token, created_at
         FROM quotations
        WHERE id = $1::uuid OR quote_number = $2 LIMIT 1`,
      [id || '00000000-0000-0000-0000-000000000000', quoteNumber || '']
    )
    if (!q) return { error: 'Quotation not found' }
    const items = await queryMany(
      `SELECT position, description, hsn_code, gst_rate::text, quantity::text, unit,
              rate::text, discount_pct::text, amount::text
         FROM quotation_items WHERE quotation_id = $1::uuid ORDER BY position`,
      [q.id]
    )
    return { ...q, items }
  },
}

const list_invoices: ToolDef = {
  name: 'list_invoices',
  description:
    'Recent invoices (drawn from orders.invoice_number IS NOT NULL). Filter by payment_status (paid|unpaid|partial|refunded), customer fragment, or days back.',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', description: 'paid | unpaid | partial | refunded' },
      customerId: { type: 'string', description: 'Substring on customer_name or customer_email.' },
      daysBack: { type: 'integer', default: 30, minimum: 1, maximum: 365 },
      limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
    },
  },
  mutating: false,
  handler: async ({ status, customerId, daysBack, limit }) => {
    const lim = clamp(typeof limit === 'number' ? limit : 20, 1, 100)
    const days = clamp(typeof daysBack === 'number' ? daysBack : 30, 1, 365)
    const params: unknown[] = [days]
    const where = [
      `o.invoice_number IS NOT NULL`,
      `o.source != 'cash_sale'`,
      `COALESCE(o.invoice_date, o.created_at) > NOW() - ($1 || ' days')::interval`,
    ]
    if (status) {
      params.push(String(status))
      where.push(`o.payment_status = $${params.length}`)
    }
    if (customerId) {
      params.push(`%${String(customerId)}%`)
      where.push(`(o.customer_name ILIKE $${params.length} OR o.customer_email ILIKE $${params.length})`)
    }
    params.push(lim)
    const rows = await queryMany(
      `SELECT o.id::text, o.invoice_number, o.invoice_date, o.order_number,
              o.customer_name, o.customer_email,
              o.total_amount::text, o.payment_status, o.status, o.source,
              o.irn_status, o.created_at
         FROM orders o
        WHERE ${where.join(' AND ')}
        ORDER BY o.invoice_date DESC NULLS LAST, o.created_at DESC
        LIMIT $${params.length}`,
      params
    )
    return { invoices: rows, count: rows.length, truncated: rows.length === lim }
  },
}

const get_invoice: ToolDef = {
  name: 'get_invoice',
  description: 'Full invoice (an order with invoice_number) including line items and IRN status.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Order UUID (invoices live on orders).' },
      invoiceNumber: { type: 'string' },
    },
  },
  mutating: false,
  handler: async ({ id, invoiceNumber }) => {
    if (!id && !invoiceNumber) throw new Error('Provide id or invoiceNumber')
    const inv = await queryOne<any>(
      `SELECT o.id::text, o.invoice_number, o.invoice_date, o.order_number,
              o.customer_name, o.customer_email, o.customer_phone,
              o.subtotal::text, o.tax_amount::text, o.total_amount::text,
              o.cgst_amount::text, o.sgst_amount::text, o.igst_amount::text,
              o.payment_status, o.status, o.source, o.buyer_gstin,
              o.irn, o.irn_status, o.eway_bill_no, o.notes, o.created_at,
              i.pdf_url
         FROM orders o LEFT JOIN invoices i ON i.order_id = o.id
        WHERE (o.id = $1::uuid OR o.invoice_number = $2) AND o.invoice_number IS NOT NULL
        LIMIT 1`,
      [id || '00000000-0000-0000-0000-000000000000', invoiceNumber || '']
    )
    if (!inv) return { error: 'Invoice not found' }
    const items = await queryMany(
      `SELECT product_name, product_sku, variant_name, hsn_code,
              gst_rate::text, quantity::text, unit_price::text, total_price::text
         FROM order_items WHERE order_id = $1::uuid ORDER BY id`,
      [inv.id]
    )
    return { ...inv, items }
  },
}

const list_cash_sales: ToolDef = {
  name: 'list_cash_sales',
  description:
    'Recent cash sales (walk-in invoices). Returns sale_number, invoice_number, customer, total, payment_mode.',
  inputSchema: {
    type: 'object',
    properties: {
      daysBack: { type: 'integer', default: 30, minimum: 1, maximum: 365 },
      limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
    },
  },
  mutating: false,
  handler: async ({ daysBack, limit }) => {
    const lim = clamp(typeof limit === 'number' ? limit : 20, 1, 100)
    const days = clamp(typeof daysBack === 'number' ? daysBack : 30, 1, 365)
    const rows = await queryMany(
      `SELECT id::text, sale_number, invoice_number, invoice_date,
              customer_name, customer_phone,
              total_amount::text, payment_mode, payment_status, created_at
         FROM cash_sales
        WHERE created_at > NOW() - ($1 || ' days')::interval
        ORDER BY created_at DESC LIMIT $2`,
      [days, lim]
    )
    return { sales: rows, count: rows.length, truncated: rows.length === lim }
  },
}

const get_cash_sale: ToolDef = {
  name: 'get_cash_sale',
  description: 'Cash sale detail including line items and payment mode. Look up by id, sale_number, or invoice_number.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      saleNumber: { type: 'string' },
      invoiceNumber: { type: 'string' },
    },
  },
  mutating: false,
  handler: async ({ id, saleNumber, invoiceNumber }) => {
    if (!id && !saleNumber && !invoiceNumber) throw new Error('Provide id, saleNumber, or invoiceNumber')
    const sale = await queryOne<any>(
      `SELECT id::text, sale_number, invoice_number, invoice_date, financial_year,
              customer_name, customer_phone, payment_mode, payment_status,
              subtotal::text, tax_amount::text, total_amount::text,
              cgst_amount::text, sgst_amount::text, igst_amount::text,
              is_igst, notes, created_at
         FROM cash_sales
        WHERE id = $1::uuid OR sale_number = $2 OR invoice_number = $3
        LIMIT 1`,
      [id || '00000000-0000-0000-0000-000000000000', saleNumber || '', invoiceNumber || '']
    )
    if (!sale) return { error: 'Cash sale not found' }
    const items = await queryMany(
      `SELECT product_name, product_sku, variant_name, hsn_code,
              gst_rate::text, quantity::text, unit_price::text, total_price::text
         FROM cash_sale_items WHERE sale_id = $1::uuid ORDER BY created_at`,
      [sale.id]
    )
    return { ...sale, items }
  },
}

interface QuotationItemInput {
  productId?: string
  variantId?: string
  subVariantId?: string
  quantity: number
  buyUnit?: string
  unitPrice?: number
  discountPct?: number
  extraDiscountPct?: number
  hsnCode?: string
  gstRate?: number
}

const unitMatches = (u: LineUnit, word: string) => normUnit(u.unit) === normUnit(word) || normUnit(u.label) === normUnit(word)

/**
 * The selling unit and quantity for a requested line, when it is unambiguous: a named unit the line sells in,
 * or pieces (bare number) as a 1-pc unit, or whole default units when the pieces divide evenly.
 */
function pickLineUnit(qty: number, requested: string | null | undefined, units: LineUnit[]) {
  const want = requested ? normUnit(requested) : ''
  if (!units.length) return !want || want === 'pc' ? { quantity: qty, unit: null } : null
  let unit: LineUnit | undefined
  let quantity = qty
  if (want && want !== 'pc') {
    unit = units.find(u => unitMatches(u, want))
  } else {
    unit = units.find(u => u.dimension === 'count' && u.factor === 1) ?? units.find(u => u.isDefault && u.dimension === 'count')
    if (unit) quantity = qty / unit.factor
  }
  if (!unit || !validatePurchaseQuantity(quantity, asSellingUnit(unit)).ok) return null
  return { quantity, unit }
}

type ResolverLine = {
  status: string
  qty: number
  requestedUnit?: string | null
  candidates: Array<{
    productId: string
    units?: LineUnit[]
    variants?: Array<{ id: string; units?: LineUnit[]; subVariants?: unknown[] }>
  }>
}

/** Items to propose straight from resolver lines, or null when any line still needs the admin (variant, unit). */
export function autoQuotationItems(lines: ResolverLine[]): QuotationItemInput[] | null {
  const out: QuotationItemInput[] = []
  for (const l of lines) {
    const c = l.candidates[0]
    if (l.status !== 'matched' || !c) return null
    let variantId: string | undefined
    let units = c.units ?? []
    if (c.variants?.length) {
      const [v, ...rest] = c.variants
      if (rest.length || v.subVariants?.length) return null
      variantId = v.id
      units = v.units ?? []
    }
    const pick = pickLineUnit(l.qty, l.requestedUnit, units)
    if (!pick) return null
    out.push({ productId: c.productId, variantId, quantity: pick.quantity, buyUnit: pick.unit?.unit })
  }
  return out.length ? out : null
}

const unitList = (units: LineUnit[]) =>
  units.map(u => (u.dimension === 'count' && u.factor !== 1 ? `${u.label} (${u.factor} pcs)` : u.label)).join(', ')

/** Last 10 digits, as the quotation editor stores phones. */
function phone10(v: unknown): string | null {
  const d = String(v ?? '').replace(/\D/g, '').slice(-10)
  return d.length === 10 ? d : null
}

// One row per requested line: the grain's own price, MRP and discount, falling back sub-variant → variant → product.
const LINE_GRAIN_SQL = `
  SELECT x.idx::int AS idx, p.id::text AS product_id, pv.id::text AS variant_id, ps.id::text AS sub_variant_id,
         p.name, pv.variant_name, ps.sub_variant_name, COALESCE(ps.sku, pv.sku, p.sku) AS sku,
         (CASE WHEN ps.id IS NOT NULL THEN ps.price WHEN pv.id IS NOT NULL THEN COALESCE(pv.price, p.base_price) ELSE p.base_price END)::float AS price,
         (CASE WHEN ps.id IS NOT NULL THEN COALESCE(ps.mrp, pv.mrp, p.mrp) WHEN pv.id IS NOT NULL THEN COALESCE(pv.mrp, p.mrp) ELSE p.mrp END)::float AS mrp,
         COALESCE(ps.discount_pct, pv.discount_pct, p.discount_pct, 0)::float AS discount_pct,
         COALESCE(p.gst_percentage, 0)::float AS gst_percentage, p.hsn_code, p.is_active, p.has_variants,
         (pv.id IS NOT NULL AND EXISTS (SELECT 1 FROM product_sub_variants s WHERE s.variant_id = pv.id AND s.is_active)) AS has_subs,
         COALESCE(ps.stock_status, pv.stock_status, p.stock_status) AS stock_status
    FROM unnest($1::uuid[], $2::uuid[], $3::uuid[]) WITH ORDINALITY AS x(pid, vid, sid, idx)
    JOIN products p ON p.id = x.pid
    LEFT JOIN product_variants pv ON pv.id = x.vid AND pv.product_id = p.id AND pv.is_active
    LEFT JOIN product_sub_variants ps ON ps.id = x.sid AND ps.variant_id = pv.id AND ps.is_active`

/**
 * Agent quotation lines priced and unit-checked the way the quotation editor does: quantity in the chosen
 * selling unit, rate per piece ex GST anchored on MRP with the catalog discount, variant names on the line.
 */
async function resolveQuotationLines(items: QuotationItemInput[]) {
  const fail = (summary: string, hint?: string) => ({ error: err(summary, undefined, hint) })
  if (items.some(i => !i.productId)) return fail('Every item needs a productId', 'Resolve products with match_quotation_items first')
  const id = (v: unknown) => (v ? String(v) : null)
  const [grains, chains, { gstEnabled }] = await Promise.all([
    queryMany<{
      idx: number
      product_id: string
      variant_id: string | null
      sub_variant_id: string | null
      name: string
      variant_name: string | null
      sub_variant_name: string | null
      sku: string | null
      price: number | null
      mrp: number | null
      discount_pct: number
      gst_percentage: number
      hsn_code: string | null
      is_active: boolean
      has_variants: boolean
      has_subs: boolean
      stock_status: string | null
    }>(LINE_GRAIN_SQL, [items.map(i => String(i.productId)), items.map(i => id(i.variantId)), items.map(i => id(i.subVariantId))]),
    unitChainsFor(items.map(i => ({ productId: String(i.productId), variantId: id(i.variantId), subVariantId: id(i.subVariantId) }))),
    getFeatureFlags(),
  ])
  const lines: QuotationLineInput[] = []
  const meta: { sku: string | null; stockStatus: string | null; unit: LineUnit | null }[] = []
  for (let n = 0; n < items.length; n++) {
    const it = items[n]
    const g = grains.find(r => r.idx === n + 1)
    const at = `Line ${n + 1}`
    if (!g || !g.is_active) return fail(`${at}: product ${it.productId} not found or inactive`)
    const name = productLabel({ product_name: g.name, variant_name: g.variant_name, sub_variant_name: g.sub_variant_name }, ' — ')
    if (it.variantId && !g.variant_id) return fail(`${at}: ${it.variantId} is not an active variant of ${g.name}`)
    if (it.subVariantId && !g.sub_variant_id) return fail(`${at}: ${it.subVariantId} is not an active sub-variant of ${name}`)
    if (g.has_variants && !g.variant_id) return fail(`${at}: ${g.name} has variants — pass variantId`, 'get_product_variants lists them')
    if (g.has_subs && !g.sub_variant_id) return fail(`${at}: ${name} has sub-variants — pass subVariantId`, 'get_product_variants lists them')

    const units = chains[n]
    const want = normUnit(it.buyUnit)
    let unit: LineUnit | null = null
    if (units.length) {
      if (!want)
        return fail(
          `${at}: ${name} sells in ${unitList(units)} — pass buyUnit and quantity in that unit`,
          `Quantity counts selling units, e.g. 50 pcs of a ${units[0].factor}-pc ${units[0].unit} = quantity ${50 / units[0].factor}, buyUnit "${units[0].unit}". Ask the admin if the pieces don't divide evenly.`
        )
      unit = units.find(u => unitMatches(u, want)) ?? null
      if (!unit) return fail(`${at}: ${name} has no unit "${it.buyUnit}" — it sells in ${unitList(units)}`)
    } else if (want && want !== 'pc') {
      return fail(`${at}: ${name} has no selling units — quantity is in pieces; omit buyUnit`)
    }
    const qty = Number(it.quantity)
    const check = validatePurchaseQuantity(qty, unit ? asSellingUnit(unit) : null)
    if (!check.ok) return fail(`${at} (${name}): ${check.reason}`)

    // Catalog prices are GST-inclusive; the line carries MRP and the discount off it.
    const gst = gstEnabled ? (it.gstRate != null ? Number(it.gstRate) : g.gst_percentage) : 0
    const mrp = Number(g.mrp) || 0
    const price = Number(g.price) || 0
    const custom = it.unitPrice != null && Number(it.unitPrice) > 0
    const incl = custom ? Number(it.unitPrice) : mrp > 0 ? mrp : price
    if (!(incl > 0)) return fail(`${at}: ${name} has no price — pass unitPrice`)
    const catalogDiscount = custom || !(mrp > 0) ? 0 : g.discount_pct > 0 ? g.discount_pct : mrp > price && price > 0 ? round2(((mrp - price) / mrp) * 100) : 0
    let discount = it.discountPct != null ? Number(it.discountPct) : catalogDiscount
    if (it.extraDiscountPct) discount = round2(100 - (100 - discount) * (1 - Number(it.extraDiscountPct) / 100))
    if (!(discount >= 0 && discount < 100)) return fail(`${at}: discount must be between 0 and 99%`)

    lines.push({
      description: name,
      quantity: qty,
      rate: incl / (1 + gst / 100),
      hsn_code: it.hsnCode || g.hsn_code || null,
      gst_rate: gst,
      unit: (unit?.label || 'PCS').toUpperCase(),
      buy_unit: unit?.unit ?? null,
      discount_pct: discount,
      product_id: g.product_id,
      variant_id: g.variant_id,
      sub_variant_id: g.sub_variant_id,
      variant_name: g.variant_name,
      sub_variant_name: g.sub_variant_name,
      sell_unit_factor: unit?.factor ?? 1,
      sell_unit_dimension: unit?.dimension ?? null,
      is_custom: false,
    })
    meta.push({ sku: g.sku, stockStatus: g.stock_status, unit })
  }
  return { lines, meta, gstEnabled }
}

function vec(arr: number[]): string {
  return '[' + arr.join(',') + ']'
}

const match_quotation_items: ToolDef = {
  name: 'match_quotation_items',
  description:
    'Take a free-form list of requested items (text per line + qty + the unit the customer wrote) and resolve them against the catalog using semantic search + text overlap scoring (0–100). Score ≥ 90 with a clear lead = matched (auto-add). Score 45–89 = ambiguous (admin confirms). Score < 45 = unmatched. Each candidate, variant and sub-variant lists its selling units (unit, factor = pieces per unit, min/max/step); the admin picks the unit and quantity in the resolver. Returns a quotation_resolver UI block for admin confirmation. Use BEFORE propose_create_quotation. Pass ALL lines in a SINGLE call (up to 50 lines). DOES NOT create anything — read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      lines: {
        type: 'string',
        description:
          'JSON array string: [{"requestedText":"<item as the customer wrote it>","qty":50,"unit":"pcs"}, {"requestedText":"<another item>","qty":2,"unit":"box"}]. Each line.qty must be > 0. unit = the unit the customer wrote (pcs, box, pack, m, kg…); omit it when they gave a bare number, which is read as pieces.',
      },
    },
    required: ['lines'],
  },
  mutating: false,
  handler: async ({ lines }) => {
    let parsed: { requestedText: string; qty: number; unit?: string | null }[]
    try {
      const raw = typeof lines === 'string' ? JSON.parse(lines) : lines
      if (!Array.isArray(raw)) throw new Error('not an array')
      parsed = raw
    } catch (_parseErr) {
      return err('Invalid lines payload', 'lines must be a JSON array of {requestedText, qty}')
    }
    if (parsed.length === 0) return err('No lines provided')
    if (parsed.length > 50) return err('Too many lines', 'Limit 50 lines per call')

    const results: Array<{
      requestedText: string
      qty: number
      requestedUnit: string | null
      status: 'matched' | 'ambiguous' | 'unmatched'
      candidates: Array<{
        productId: string
        name: string
        sku: string | null
        price: number
        sim: number
        score: number
        units?: LineUnit[]
        variants?: Array<{ id: string; units?: LineUnit[]; subVariants?: Array<{ id: string; units?: LineUnit[] }> }>
      }>
    }> = []

    for (const line of parsed) {
      const text = String(line.requestedText || '').trim()
      const qty = Number(line.qty)
      const requestedUnit = line.unit ? String(line.unit).trim() || null : null
      if (!text || !isFinite(qty) || qty <= 0) {
        results.push({ requestedText: text, qty, requestedUnit, status: 'unmatched', candidates: [] })
        continue
      }
      const v = await embed(text)
      const hnswResult = await runWithHnswTuning(
        `SELECT source_table, source_id, 1 - (embedding <=> $1::vector) AS sim
         FROM embeddings
         WHERE source_table IN ('products', 'product_variants')
         ORDER BY embedding <=> $1::vector LIMIT 30`,
        [vec(v)]
      ).catch(() => ({ rows: [] as { source_table: string; source_id: string; sim: number }[] }))
      const ids = hnswResult.rows.map(r => ({ ...r, sim: typeof r.sim === 'string' ? parseFloat(r.sim) : r.sim }))

      const productSimMap = new Map<string, number>()
      for (const r of ids) {
        if (r.source_table === 'products') {
          if (!productSimMap.has(r.source_id) || productSimMap.get(r.source_id)! < r.sim) {
            productSimMap.set(r.source_id, r.sim)
          }
        }
      }
      const variantSrcIds = ids.filter(r => r.source_table === 'product_variants').map(r => r.source_id)
      if (variantSrcIds.length) {
        const vp = await queryMany<{ id: string; product_id: string }>(
          `SELECT id::text, product_id::text FROM product_variants WHERE id = ANY($1::uuid[])`,
          [variantSrcIds]
        )
        const idToProduct = new Map(vp.map(r => [r.id, r.product_id]))
        for (const r of ids) {
          if (r.source_table === 'product_variants') {
            const pid = idToProduct.get(r.source_id)
            if (pid) {
              const cur = productSimMap.get(pid) ?? 0
              if (r.sim > cur) productSimMap.set(pid, r.sim)
            }
          }
        }
      }

      // Text fallback: when HNSW returns 0 product candidates (replica unreachable or no embeddings),
      // do an ILIKE search on the primary DB so we still surface obvious name matches
      if (productSimMap.size === 0) {
        const words = text
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .trim()
          .split(/\s+/)
          .filter(w => w.length >= 3)
        if (words.length > 0) {
          // Try each significant word as an ILIKE pattern; use the longest word first for selectivity
          const sorted = [...words].sort((a, b) => b.length - a.length)
          for (const word of sorted.slice(0, 3)) {
            const fallbackRows = await queryMany<{ id: string; name: string }>(
              `SELECT id::text, name FROM products WHERE is_active = TRUE AND name ILIKE $1 LIMIT 20`,
              [`%${word}%`]
            ).catch(() => [] as { id: string; name: string }[])
            for (const r of fallbackRows) {
              if (!productSimMap.has(r.id)) productSimMap.set(r.id, 0.3) // low sim — will score via JS signals
            }
            if (productSimMap.size >= 5) break
          }
        }
      }

      const productIds = Array.from(productSimMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([id]) => id)
      const candidates: Array<{
        productId: string
        name: string
        sku: string | null
        price: number
        sim: number
        score: number
        imageUrl?: string | null
        variants?: Array<{
          id: string
          name: string
          sku: string | null
          price: number
          subVariants?: Array<{ id: string; name: string; sku: string | null; price: number }>
        }>
      }> = []
      if (productIds.length > 0) {
        const rows = await queryMany<{ id: string; name: string; sku: string | null; price: number }>(
          `SELECT p.id::text, p.name, p.sku,
                  COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::float AS price
           FROM products p
           WHERE p.id = ANY($1::uuid[]) AND p.is_active = TRUE`,
          [productIds]
        )
        // Run all four JS signal agents in parallel per candidate
        const scored = await Promise.all(
          rows.map(async r => {
            const sim = productSimMap.get(r.id) ?? 0
            const [tokenOverlap, specNum, skuFrag] = await Promise.all([
              Promise.resolve(tokenOverlapSignal(text, r.name)),
              Promise.resolve(specNumberSignal(text, r.name)),
              Promise.resolve(skuFragmentSignal(text, r.sku)),
            ])
            const score = aggregateSignals(embeddingSignal(sim), tokenOverlap, specNum, skuFrag)
            return { productId: r.id, name: r.name, sku: r.sku, price: Number(r.price) || 0, sim, score }
          })
        )
        candidates.push(...scored)
      }
      candidates.sort((a, b) => b.score - a.score)

      // Haiku tiebreaker: only for the top candidate when score is in the ambiguous band
      if (candidates.length > 0 && candidates[0].score >= 45 && candidates[0].score < 90) {
        const override = await haikuTiebreakerScore(text, candidates[0].name)
        if (override !== null) candidates[0].score = override
      }
      candidates.sort((a, b) => b.score - a.score)

      let status: 'matched' | 'ambiguous' | 'unmatched'
      if (candidates.length === 0 || candidates[0].score < 45) status = 'unmatched'
      else if (candidates[0].score >= 80 && (candidates.length === 1 || candidates[0].score - candidates[1].score >= 5))
        status = 'matched'
      else status = 'ambiguous'

      // Enrich top-3 candidates with image + variant/subvariant data
      const topCandidates = candidates.slice(0, 3)
      const enrichIds = topCandidates.map(c => c.productId)
      if (enrichIds.length > 0) {
        type VariantRow = {
          product_id: string
          id: string
          name: string
          sku: string | null
          price: number
          sub_variants: string
        }
        const [images, variantRows] = await Promise.all([
          queryMany<{ product_id: string; url: string }>(
            `SELECT DISTINCT ON (product_id) product_id::text, image_url AS url
             FROM product_images
             WHERE product_id = ANY($1::uuid[])
             ORDER BY product_id, is_primary DESC, display_order ASC`,
            [enrichIds]
          ).catch(() => [] as { product_id: string; url: string }[]),
          queryMany<VariantRow>(
            `SELECT pv.product_id::text, pv.id::text, pv.variant_name AS name, pv.sku,
                    COALESCE(NULLIF(
                      CASE WHEN EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
                           THEN (SELECT MIN(sv.price) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true AND sv.price IS NOT NULL)
                           ELSE pv.price END
                    , 0), 0)::float AS price,
                    COALESCE((
                      SELECT json_agg(json_build_object('id', sv.id, 'name', sv.sub_variant_name, 'sku', sv.sku, 'price', sv.price::float) ORDER BY sv.sub_variant_name)
                      FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true
                    ), '[]'::json)::text AS sub_variants
             FROM product_variants pv
             WHERE pv.product_id = ANY($1::uuid[]) AND pv.is_active = true
             ORDER BY pv.product_id, pv.variant_name`,
            [enrichIds]
          ).catch(() => [] as VariantRow[]),
        ])

        const imageByProduct = new Map(images.map(i => [i.product_id, i.url]))
        const variantsByProduct = new Map<string, typeof variantRows>()
        for (const v of variantRows) {
          if (!variantsByProduct.has(v.product_id)) variantsByProduct.set(v.product_id, [])
          variantsByProduct.get(v.product_id)!.push(v)
        }

        for (const c of topCandidates) {
          c.imageUrl = imageByProduct.get(c.productId) ?? null
          const pvs = variantsByProduct.get(c.productId) ?? []
          if (pvs.length > 0) {
            c.variants = pvs.map(v => {
              let subVariants: Array<{ id: string; name: string; sku: string | null; price: number }> = []
              try {
                subVariants = JSON.parse(v.sub_variants)
              } catch {
                /* ok */
              }
              return { id: v.id, name: v.name, sku: v.sku, price: v.price, subVariants }
            })
          }
        }
      }

      results.push({
        requestedText: text,
        qty,
        requestedUnit,
        status,
        candidates: topCandidates,
      })
    }

    // Selling units for every candidate scope the resolver can pick (product, variant, sub-variant).
    const scopes: { productId: string; variantId?: string; subVariantId?: string; target: { units?: LineUnit[] } }[] = []
    for (const r of results)
      for (const c of r.candidates) {
        scopes.push({ productId: c.productId, target: c })
        for (const v of c.variants ?? []) {
          scopes.push({ productId: c.productId, variantId: v.id, target: v })
          for (const sv of v.subVariants ?? []) scopes.push({ productId: c.productId, variantId: v.id, subVariantId: sv.id, target: sv })
        }
      }
    const chains = await unitChainsFor(scopes)
    scopes.forEach((sc, i) => (sc.target.units = chains[i]))

    const counts = {
      matched: results.filter(r => r.status === 'matched').length,
      ambiguous: results.filter(r => r.status === 'ambiguous').length,
      unmatched: results.filter(r => r.status === 'unmatched').length,
    }

    return ok({
      summary:
        `Resolved ${counts.matched}/${results.length} lines exactly` +
        (counts.ambiguous > 0 ? `, ${counts.ambiguous} need confirmation` : '') +
        (counts.unmatched > 0 ? `, ${counts.unmatched} unmatched` : '') +
        '.',
      count: results.length,
      data: { lines: results, counts },
      uiBlocks: [
        {
          type: 'quotation_resolver',
          lines: results,
          counts,
        },
      ],
      displayHints: { primaryField: 'requestedText', itemNoun: 'line' },
    })
  },
}

const extract_quotation_lines_from_attachment: ToolDef = {
  name: 'extract_quotation_lines_from_attachment',
  description:
    'Read an uploaded file (PDF, image jpg/png/webp, or scanned PDF) and return its raw text so YOU can parse line-items. Use this when the admin attaches a quotation request document. Workflow: call this tool with the attachment_id from the chat, read the returned text, parse it into [{requestedText, qty, unit}] (unit as written: pcs, box, m…; omit for a bare number), then call match_quotation_items. Falls back from pdf-parse → vision OCR for scanned PDFs. Vision OCR for images runs against the configured Razer model.',
  inputSchema: {
    type: 'object',
    properties: {
      attachment_id: { type: 'string', description: 'UUID returned by /api/admin/agent/upload.' },
    },
    required: ['attachment_id'],
  },
  mutating: false,
  handler: async ({ attachment_id }) => {
    const id = String(attachment_id || '').trim()
    if (!id) return err('attachment_id is required')

    const row = await queryOne<{
      id: string
      mime_type: string
      filename: string | null
      byte_size: number
      data: Buffer
      extracted_text: string | null
      expires_at: string
    }>(
      `SELECT id::text, mime_type, filename, byte_size, data, extracted_text, expires_at::text
       FROM admin_agent_attachments
       WHERE id = $1::uuid AND expires_at > NOW()`,
      [id]
    )
    if (!row) return err('Attachment not found or expired', undefined, 'Ask the admin to re-upload the file.')

    if (row.extracted_text && row.extracted_text.trim()) {
      return ok({
        summary: `Re-using cached text from ${row.filename || row.mime_type} (${row.byte_size} bytes).`,
        data: { text: row.extracted_text, mime_type: row.mime_type, filename: row.filename },
        meta: { cached: true },
      })
    }

    if (row.mime_type === 'application/pdf') {
      let text = ''
      try {
        const pdfParseMod = await import('pdf-parse')
        const pdfParse =
          (pdfParseMod as { default?: (b: Buffer) => Promise<{ text: string }> }).default ||
          (pdfParseMod as unknown as (b: Buffer) => Promise<{ text: string }>)
        const parsed = await pdfParse(row.data)
        text = (parsed?.text || '').trim()
      } catch {
        text = ''
      }

      if (!text) {
        const visionResult = await ocrPdfPages(row.data, { maxPages: 10 })
        if (!visionResult.ok) {
          return err(
            'Could not extract text from PDF',
            visionResult.reason,
            visionResult.hint || 'Try a higher-resolution scan, or retype the line-items manually.'
          )
        }
        text = visionResult.text
        await query(`UPDATE admin_agent_attachments SET extracted_text = $2 WHERE id = $1::uuid`, [id, text]).catch(
          () => {}
        )
        return ok({
          summary: `Vision OCR extracted ${text.length} chars from ${visionResult.pages || '?'} page(s) of "${row.filename || 'PDF'}".`,
          data: { text, mime_type: row.mime_type, filename: row.filename },
          meta: {
            cached: false,
            char_count: text.length,
            source: 'vision_ocr',
            pages: visionResult.pages,
            model: visionResult.model,
          },
        })
      }

      await query(`UPDATE admin_agent_attachments SET extracted_text = $2 WHERE id = $1::uuid`, [id, text]).catch(
        () => {}
      )
      return ok({
        summary: `Extracted ${text.length} chars from PDF "${row.filename || 'upload'}".`,
        data: { text, mime_type: row.mime_type, filename: row.filename },
        meta: { cached: false, char_count: text.length, source: 'pdf_text' },
      })
    }

    if (row.mime_type.startsWith('image/')) {
      const visionResult = await ocrImage(row.data, row.mime_type)
      if (!visionResult.ok) {
        return err(
          'Image OCR failed',
          visionResult.reason,
          visionResult.hint || 'Make sure the configured vision model is reachable.'
        )
      }
      const text = visionResult.text
      await query(`UPDATE admin_agent_attachments SET extracted_text = $2 WHERE id = $1::uuid`, [id, text]).catch(
        () => {}
      )
      return ok({
        summary: `Vision OCR extracted ${text.length} chars from "${row.filename || 'image'}".`,
        data: { text, mime_type: row.mime_type, filename: row.filename },
        meta: { cached: false, char_count: text.length, source: 'vision_ocr', model: visionResult.model },
      })
    }

    return err(`Unsupported attachment type: ${row.mime_type}`)
  },
}

const propose_create_quotation: ToolDef = {
  name: 'propose_create_quotation',
  description:
    'Propose creating a draft quotation for a customer, priced exactly like the quotation editor: each line is a specific variant/sub-variant, quantity is in its selling unit, the price is MRP with the catalog discount, and the customer\'s phone, GSTIN and saved address are filled in. Pass items as a JSON-stringified array. Lines are validated against the selling unit\'s min/max/step. Admin must approve before the draft is created.',
  inputSchema: {
    type: 'object',
    properties: {
      customerEmail: {
        type: 'string',
        description: 'Email of the consignee (and buyer, since buyer_same defaults true).',
      },
      addressId: {
        type: 'string',
        description:
          'UUID of a saved address from the addresses table. Pass this when the admin picks an address via the choice_picker instead of typing individual fields.',
      },
      consigneeName: {
        type: 'string',
        description: 'Override consignee name. If omitted, looked up from users table.',
      },
      consigneePhone: { type: 'string', description: 'Override consignee phone.' },
      consigneeAddr1: { type: 'string', description: 'Address line 1.' },
      consigneeAddr2: { type: 'string', description: 'Address line 2.' },
      consigneeCity: { type: 'string', description: 'City.' },
      consigneeState: { type: 'string', description: "State; defaults to the store's own state when omitted." },
      consigneeGstin: { type: 'string', description: 'GSTIN of consignee.' },
      consigneePincode: { type: 'string', description: 'Pincode.' },
      buyerSame: { type: 'boolean', description: 'Whether buyer is same as consignee. Defaults true.' },
      buyerName: { type: 'string' },
      buyerAddr1: { type: 'string' },
      buyerAddr2: { type: 'string' },
      buyerCity: { type: 'string' },
      buyerState: { type: 'string' },
      buyerGstin: { type: 'string' },
      buyerPhone: { type: 'string' },
      buyerPincode: { type: 'string' },
      buyerEmail: { type: 'string' },
      items: {
        type: 'string',
        description:
          'JSON array: [{productId, variantId?, subVariantId?, quantity, buyUnit?, unitPrice?, discountPct?, extraDiscountPct?, hsnCode?, gstRate?}]. variantId is required for products with variants, subVariantId for variants with sub-variants. quantity is in buyUnit; buyUnit is required when the line has selling units (match_quotation_items lists them with factor = pieces per unit), so 50 pcs of a 10-pc box is quantity 5, buyUnit "box". Omit unitPrice to use the catalog price (MRP with its discount). unitPrice = a custom price per PIECE incl. GST (no catalog discount then). discountPct = the total discount % off MRP, replacing the catalog one; extraDiscountPct = an extra % off on top of the catalog discount.',
      },
      notes: { type: 'string', description: 'Optional internal notes for the quotation.' },
      quoteDate: { type: 'string', description: 'ISO date string YYYY-MM-DD. Defaults to today.' },
    },
    required: ['customerEmail', 'items'],
  },
  mutating: true,
  handler: async args => {
    const {
      customerEmail,
      addressId,
      consigneeName: nameOverride,
      consigneePhone,
      consigneeAddr1,
      consigneeAddr2,
      consigneeCity,
      consigneeState,
      consigneeGstin,
      consigneePincode,
      buyerSame,
      buyerName,
      buyerAddr1,
      buyerAddr2,
      buyerCity,
      buyerState,
      buyerGstin,
      buyerPhone,
      buyerPincode,
      buyerEmail,
      items,
      notes,
      quoteDate,
    } = args as Record<string, any>

    const email = String(customerEmail || '').trim()
    if (!email.includes('@')) throw new Error('customerEmail must be a valid email')

    let parsed: QuotationItemInput[]
    try {
      const raw = typeof items === 'string' ? JSON.parse(items) : items
      if (!Array.isArray(raw)) throw new Error('not an array')
      parsed = raw as QuotationItemInput[]
    } catch {
      throw new Error('items must be a JSON array')
    }
    if (parsed.length < 1 || parsed.length > 50) throw new Error('items: provide 1-50 lines')

    const resolved = await resolveQuotationLines(parsed)
    if ('error' in resolved) return resolved.error
    const { lines, meta, gstEnabled } = resolved

    const customer = await queryOne<{
      user_id: string
      first_name: string | null
      last_name: string | null
      phone: string | null
      business_address: string | null
      gst_number: string | null
      company_name: string | null
    }>(
      `SELECT u.id::text AS user_id, u.first_name, u.last_name, u.phone,
              bp.business_address,
              COALESCE(cp.gst_number, bp.gst_number) AS gst_number,
              COALESCE(cp.company_name, bp.company_name) AS company_name
         FROM users u
         LEFT JOIN business_profiles bp ON bp.user_id = u.id
         LEFT JOIN customer_profiles cp ON cp.user_id = u.id
        WHERE u.email = $1 LIMIT 1`,
      [email]
    )

    // Resolve display name — fall back to email-prefix (never raw email)
    const emailPrefix = email.split('@')[0]
    const consigneeNameResolved = nameOverride
      ? String(nameOverride).trim()
      : customer
        ? customer.company_name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || emailPrefix
        : emailPrefix

    // Fetch saved addresses for the user (or resolve a specific one by ID)
    const savedAddresses = customer?.user_id
      ? await queryMany<{
          id: string
          full_name: string
          phone: string
          address_line1: string
          address_line2: string | null
          city: string
          state: string
          postal_code: string
          is_default: boolean
          address_type: string
        }>(
          `SELECT id::text, full_name, phone, address_line1, address_line2,
                  city, state, postal_code, is_default, address_type
             FROM addresses
            WHERE user_id = $1
            ORDER BY is_default DESC, created_at DESC`,
          [customer.user_id]
        )
      : []

    // If a specific addressId was passed (from picker), resolve it directly
    const pickedAddr = addressId ? (savedAddresses.find(a => a.id === String(addressId)) ?? null) : null

    // Address disambiguation: if no explicit address and no picked ID, and multiple saved addresses exist
    const hasExplicitAddress = !!(consigneeAddr1 || consigneeCity || consigneeState || consigneePincode)
    if (!hasExplicitAddress && !pickedAddr && savedAddresses.length > 1) {
      return {
        needs_choice: true,
        choice_kind: 'address',
        options: savedAddresses.map(a => ({
          id: a.id,
          label: `${a.full_name} — ${a.address_line1}, ${a.city}`,
          sublabel: `${a.state} ${a.postal_code} · ${a.phone}${a.is_default ? ' · default' : ''}`,
        })),
        note: `${consigneeNameResolved} has ${savedAddresses.length} saved addresses — pick one to use on the quotation`,
      }
    }

    // Use the picked address, or the single/default saved address if no explicit fields provided
    const addrToUse =
      pickedAddr ??
      (!hasExplicitAddress && savedAddresses.length === 1 ? savedAddresses[0] : null) ??
      (!hasExplicitAddress ? (savedAddresses.find(a => a.is_default) ?? null) : null)

    // Fallback consignee state is the store's own state (site_settings), never a flagship default.
    const { storeOrigin } = await import('@/lib/catalog/brand')
    const storeState = (await storeOrigin()).state

    // The same body the quotation editor posts; the executor sends it to POST /api/admin/quotations.
    const payload = {
      consignee_email: email,
      consignee_name: consigneeNameResolved,
      consignee_phone: phone10(consigneePhone || customer?.phone || addrToUse?.phone),
      consignee_addr1: consigneeAddr1 || addrToUse?.address_line1 || customer?.business_address || '',
      consignee_addr2: consigneeAddr2 || addrToUse?.address_line2 || null,
      consignee_city: consigneeCity || addrToUse?.city || '',
      consignee_state: consigneeState || addrToUse?.state || storeState,
      consignee_gstin: consigneeGstin ? String(consigneeGstin).toUpperCase() : customer?.gst_number || null,
      consignee_pincode: consigneePincode || addrToUse?.postal_code || null,
      buyer_same: buyerSame !== false,
      buyer_name: buyerName || null,
      buyer_addr1: buyerAddr1 || null,
      buyer_addr2: buyerAddr2 || null,
      buyer_city: buyerCity || null,
      buyer_state: buyerState || null,
      buyer_gstin: buyerGstin ? String(buyerGstin).toUpperCase() : null,
      buyer_phone: phone10(buyerPhone),
      buyer_pincode: buyerPincode || null,
      buyer_email: buyerEmail || null,
      notes: notes ? String(notes).slice(0, 500) : null,
      quote_date: quoteDate || new Date().toISOString().slice(0, 10),
      items: lines,
    }
    if (!payload.buyer_same && !(payload.buyer_name && payload.buyer_addr1 && payload.buyer_city))
      return err('A separate buyer needs buyerName, buyerAddr1 and buyerCity', undefined, 'Or leave buyerSame true')

    const rows = lines.map(l => quotationLineRow(quotationLineSchema.parse(l), gstEnabled))
    const totals = quotationTotals(rows)
    // What finalising will ask for; the draft saves without them.
    const missing = [
      !payload.consignee_phone && 'phone number',
      !payload.consignee_addr1 && 'address',
      !payload.consignee_city && 'city',
    ].filter(Boolean)
    const discountTotal = rows.reduce((t, r) => t + r.quantity * (r.sold_unit_factor || 1) * r.rate * (r.discount_pct / 100), 0)

    return {
      proposed: true,
      kind: 'create_quotation',
      payload: { ...payload, total: totals.total_amount },
      confirmation: `Create draft quotation for ${consigneeNameResolved} (${email}) with ${rows.length} line${rows.length === 1 ? '' : 's'}, total ₹${fmtINR(totals.total_amount)}?`,
      ui_blocks: [
        {
          type: 'document',
          kind: 'quotation',
          title: 'Quotation',
          subtitle: `Draft · ${payload.quote_date}`,
          status: { label: 'Draft', tone: 'neutral' },
          parties: [
            {
              label: payload.buyer_same ? 'Bill & ship to' : 'Ship to',
              name: consigneeNameResolved,
              lines: [
                [payload.consignee_addr1, payload.consignee_addr2].filter(Boolean).join(', '),
                [payload.consignee_city, payload.consignee_state, payload.consignee_pincode].filter(Boolean).join(', '),
                [payload.consignee_phone && `+91 ${payload.consignee_phone}`, email].filter(Boolean).join(' · '),
                payload.consignee_gstin ? `GSTIN ${payload.consignee_gstin}` : '',
              ].filter(Boolean),
            },
            ...(payload.buyer_same
              ? []
              : [
                  {
                    label: 'Bill to',
                    name: payload.buyer_name!,
                    lines: [
                      [payload.buyer_addr1, payload.buyer_addr2].filter(Boolean).join(', '),
                      [payload.buyer_city, payload.buyer_state, payload.buyer_pincode].filter(Boolean).join(', '),
                      payload.buyer_gstin ? `GSTIN ${payload.buyer_gstin}` : '',
                    ].filter(Boolean),
                  },
                ]),
          ],
          lines: rows.map((r, n) => ({
            name: r.description,
            sku: meta[n].sku,
            href: `/admin/products/${r.product_id}`,
            qty: r.quantity,
            unit: meta[n].unit ? meta[n].unit!.label : 'pcs',
            baseQty: r.base_quantity ? `= ${r.base_quantity} pcs` : null,
            rate: round2(r.rate * (1 + r.gst_rate / 100)),
            rateNote: 'per pc incl. GST',
            discountPct: r.discount_pct || null,
            taxPct: gstEnabled ? r.gst_rate : null,
            amount: round2(r.amount * (1 + r.gst_rate / 100)),
            warning: meta[n].stockStatus === 'Out of Stock' ? 'Out of Stock on the store' : null,
          })),
          totals: [
            { key: 'Subtotal (ex GST)', value: round2(totals.subtotal) },
            ...(discountTotal > 0 ? [{ key: 'Discount (ex GST)', value: round2(discountTotal) }] : []),
            ...(gstEnabled ? [{ key: 'CGST + SGST', value: round2(totals.cgst_amount + totals.sgst_amount) }] : []),
            { key: 'Total', value: totals.total_amount, emphasis: true },
          ],
          notes: payload.notes,
          footnote: missing.length
            ? `Saved as a draft. Add the ${missing.join(', ')} before finalising.`
            : 'Saved as a draft — finalise it from Quotations.',
        },
      ],
    }
  },
}

const propose_send_quotation_email: ToolDef = {
  name: 'propose_send_quotation_email',
  description:
    "Propose sending the quotation PDF link to the customer. Defaults toEmail to the quotation's consignee_email. Admin must approve before send.",
  inputSchema: {
    type: 'object',
    properties: {
      quotationId: { type: 'string', description: 'Quotation UUID.' },
      quoteNumber: { type: 'string', description: 'Alternative to quotationId.' },
      toEmail: { type: 'string', description: 'Override recipient. Defaults to consignee_email on the quotation.' },
    },
  },
  mutating: true,
  handler: async ({ quotationId, quoteNumber, toEmail }) => {
    if (!quotationId && !quoteNumber) throw new Error('Provide quotationId or quoteNumber')
    const q = await queryOne<{
      id: string
      quote_number: string
      status: string
      consignee_email: string | null
      consignee_name: string | null
      total_amount: string
      view_token: string
      quote_date: string
    }>(
      `SELECT id::text, quote_number, status, consignee_email, consignee_name,
              total_amount::text, view_token::text, quote_date
         FROM quotations
        WHERE id = $1::uuid OR quote_number = $2 LIMIT 1`,
      [quotationId || '00000000-0000-0000-0000-000000000000', quoteNumber || '']
    )
    if (!q) throw new Error('Quotation not found')
    const recipient = String(toEmail || q.consignee_email || '').trim()
    if (!recipient.includes('@'))
      throw new Error('No valid recipient — pass toEmail or set consignee_email on the quotation first')
    if (q.status === 'cancelled') {
      return { proposed: false, info: `Quotation ${q.quote_number} is cancelled — email not appropriate.` }
    }
    const validUntil = new Date(q.quote_date)
    validUntil.setDate(validUntil.getDate() + 15)

    return {
      proposed: true,
      kind: 'send_quotation_email',
      payload: {
        quotationId: q.id,
        quoteNumber: q.quote_number,
        toEmail: recipient,
        consigneeName: q.consignee_name || '',
        totalAmount: Number(q.total_amount),
        viewToken: q.view_token,
      },
      confirmation: `Email quotation ${q.quote_number} (₹${fmtINR(q.total_amount)}) to ${recipient}?`,
      ui_blocks: [
        { type: 'heading', value: `Send quotation ${q.quote_number}`, level: 2 },
        {
          type: 'kv_pairs',
          pairs: [
            { key: 'Recipient', value: recipient },
            { key: 'Quotation', value: q.quote_number },
            { key: 'Total', value: `₹${fmtINR(q.total_amount)}` },
            { key: 'Valid until', value: fmtDate(validUntil) },
          ],
        },
        {
          type: 'text',
          value: `Customer will receive the public link ${await documentUrl('quotation', q.view_token)}.`,
          weight: 'muted',
        },
      ],
    }
  },
}

export const SALES_TOOLS: ToolDef[] = [
  list_quotations,
  get_quotation,
  list_invoices,
  get_invoice,
  list_cash_sales,
  get_cash_sale,
  match_quotation_items,
  extract_quotation_lines_from_attachment,
  propose_create_quotation,
  propose_send_quotation_email,
]
