import { query, queryMany, queryOne } from '@/lib/db'
import { round2 } from '@/lib/gst'
import { VARIANT_MIN_PRICE_SQL } from '@/lib/queries'
import { embed, queryManyReplica } from '@/lib/rag'
import type { ToolDef } from '../tools'
import { ok, err } from '../tool-envelope'
import { ocrImage, ocrPdfPages } from '../vision'

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)) }
function fmtINR(n: number | string | null | undefined): string {
  const num = typeof n === 'number' ? n : Number(n || 0)
  if (!isFinite(num)) return '—'
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return String(d) }
}

const ORDER_STATUS_FLOW = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled']
const PAYMENT_MODES = ['cash', 'card', 'upi', 'bank_transfer', 'cheque', 'razorpay', 'credit']

const list_quotations: ToolDef = {
  name: 'list_quotations',
  description: 'Recent quotations, optionally filtered by status (draft|final|cancelled), by customer (substring on consignee_name/email), or by days back. Returns quote_number, customer, total, status.',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', description: 'draft | final | cancelled' },
      customerId: { type: 'string', description: 'Substring match on consignee_name or consignee_email — quotations are not strictly tied to a users.id, so this is a fuzzy filter.' },
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
    if (status) { params.push(String(status)); where.push(`q.status = $${params.length}`) }
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
  description: 'Recent invoices (drawn from orders.invoice_number IS NOT NULL). Filter by payment_status (paid|unpaid|partial|refunded), customer fragment, or days back.',
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
    const where = [`o.invoice_number IS NOT NULL`, `o.source != 'cash_sale'`,
                   `COALESCE(o.invoice_date, o.created_at) > NOW() - ($1 || ' days')::interval`]
    if (status) { params.push(String(status)); where.push(`o.payment_status = $${params.length}`) }
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
  description: 'Recent cash sales (walk-in invoices). Returns sale_number, invoice_number, customer, total, payment_mode.',
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

interface QuotationItemInput { productId?: string; variantId?: string; quantity: number; unitPrice?: number }

function vec(arr: number[]): string { return '[' + arr.join(',') + ']' }

const match_quotation_items: ToolDef = {
  name: 'match_quotation_items',
  description: 'Take a free-form list of requested items (text per line + qty) and resolve them against the catalog using semantic search. Returns each line as matched | ambiguous | unmatched with up to 3 candidate products per ambiguous line. Use BEFORE propose_create_quotation when the admin gives a free-form request like "50 M27 bolts, 200 washers". IMPORTANT: pass ALL lines in a SINGLE call (up to 50 lines). Do NOT split into multiple calls. DOES NOT create anything — read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      lines: {
        type: 'string',
        description: 'JSON array string: [{"requestedText":"M27 structural bolt","qty":50}, {"requestedText":"flat washer 8mm","qty":200}]. Each line.qty must be > 0.',
      },
      simThreshold: {
        type: 'number',
        description: 'Cosine similarity threshold for "matched" vs "ambiguous". Default 0.62.',
        default: 0.62,
      },
    },
    required: ['lines'],
  },
  mutating: false,
  handler: async ({ lines, simThreshold }) => {
    let parsed: { requestedText: string; qty: number }[]
    try {
      const raw = typeof lines === 'string' ? JSON.parse(lines) : lines
      if (!Array.isArray(raw)) throw new Error('not an array')
      parsed = raw
    } catch (_parseErr) {
      return err('Invalid lines payload', 'lines must be a JSON array of {requestedText, qty}')
    }
    if (parsed.length === 0) return err('No lines provided')
    if (parsed.length > 50) return err('Too many lines', 'Limit 50 lines per call')

    const threshold = typeof simThreshold === 'number' ? Math.max(0.3, Math.min(0.95, simThreshold)) : 0.62

    const results: Array<{
      requestedText: string
      qty: number
      status: 'matched' | 'ambiguous' | 'unmatched'
      candidates: Array<{ productId: string; name: string; sku: string | null; price: number; sim: number }>
    }> = []

    for (const line of parsed) {
      const text = String(line.requestedText || '').trim()
      const qty = Number(line.qty)
      if (!text || !isFinite(qty) || qty <= 0) {
        results.push({ requestedText: text, qty, status: 'unmatched', candidates: [] })
        continue
      }
      const v = await embed(text)
      const ids = await queryManyReplica<{ source_table: string; source_id: string; sim: number }>(
        `SELECT source_table, source_id, 1 - (embedding <=> $1::vector) AS sim
         FROM embeddings WHERE source_table IN ('products', 'product_variants')
         ORDER BY embedding <=> $1::vector LIMIT 6`,
        [vec(v)]
      ).catch(() => [])

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

      const productIds = Array.from(productSimMap.keys()).slice(0, 8)
      const candidates: Array<{ productId: string; name: string; sku: string | null; price: number; sim: number }> = []
      if (productIds.length > 0) {
        const rows = await queryMany<{ id: string; name: string; sku: string | null; price: number }>(
          `SELECT p.id::text, p.name, p.sku,
                  COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::float AS price
           FROM products p
           WHERE p.id = ANY($1::uuid[]) AND p.is_active = TRUE`,
          [productIds]
        )
        for (const r of rows) {
          candidates.push({ productId: r.id, name: r.name, sku: r.sku, price: Number(r.price) || 0, sim: productSimMap.get(r.id) ?? 0 })
        }
      }
      candidates.sort((a, b) => b.sim - a.sim)

      let status: 'matched' | 'ambiguous' | 'unmatched'
      if (candidates.length === 0 || candidates[0].sim < 0.45) status = 'unmatched'
      else if (candidates[0].sim >= threshold && (candidates.length === 1 || candidates[0].sim - candidates[1].sim >= 0.05)) status = 'matched'
      else status = 'ambiguous'

      results.push({
        requestedText: text,
        qty,
        status,
        candidates: candidates.slice(0, 3),
      })
    }

    const counts = {
      matched: results.filter(r => r.status === 'matched').length,
      ambiguous: results.filter(r => r.status === 'ambiguous').length,
      unmatched: results.filter(r => r.status === 'unmatched').length,
    }

    return ok({
      summary: `Resolved ${counts.matched}/${results.length} lines exactly` +
        (counts.ambiguous > 0 ? `, ${counts.ambiguous} ambiguous` : '') +
        (counts.unmatched > 0 ? `, ${counts.unmatched} unmatched` : '') + '.',
      count: results.length,
      data: { lines: results, counts, threshold },
      displayHints: { primaryField: 'requestedText', itemNoun: 'line' },
    })
  },
}

const extract_quotation_lines_from_attachment: ToolDef = {
  name: 'extract_quotation_lines_from_attachment',
  description: 'Read an uploaded file (PDF, image jpg/png/webp, or scanned PDF) and return its raw text so YOU can parse line-items. Use this when the admin attaches a quotation request document. Workflow: call this tool with the attachment_id from the chat, read the returned text, parse it into [{requestedText, qty}], then call match_quotation_items. Falls back from pdf-parse → vision OCR for scanned PDFs. Vision OCR for images runs against the configured Razer model.',
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
        const pdfParse = (pdfParseMod as { default?: (b: Buffer) => Promise<{ text: string }>; }).default
          || (pdfParseMod as unknown as (b: Buffer) => Promise<{ text: string }>)
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
        await query(
          `UPDATE admin_agent_attachments SET extracted_text = $2 WHERE id = $1::uuid`,
          [id, text]
        ).catch(() => {})
        return ok({
          summary: `Vision OCR extracted ${text.length} chars from ${visionResult.pages || '?'} page(s) of "${row.filename || 'PDF'}".`,
          data: { text, mime_type: row.mime_type, filename: row.filename },
          meta: { cached: false, char_count: text.length, source: 'vision_ocr', pages: visionResult.pages, model: visionResult.model },
        })
      }

      await query(
        `UPDATE admin_agent_attachments SET extracted_text = $2 WHERE id = $1::uuid`,
        [id, text]
      ).catch(() => {})
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
      await query(
        `UPDATE admin_agent_attachments SET extracted_text = $2 WHERE id = $1::uuid`,
        [id, text]
      ).catch(() => {})
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
  description: 'Propose creating a draft quotation for a customer with the given line items. Pass items as a JSON-stringified array (each: {productId, quantity, unitPrice?, variantId?}). If unitPrice is omitted, the variant min-price (or product base_price) is used. Admin must approve before the draft is created.',
  inputSchema: {
    type: 'object',
    properties: {
      customerEmail: { type: 'string', description: 'Email of the consignee (and buyer, since buyer_same defaults true).' },
      items: { type: 'string', description: 'JSON array string: [{"productId":"<uuid>","quantity":2,"unitPrice":499.50}]' },
      notes: { type: 'string', description: 'Optional internal notes for the quotation.' },
    },
    required: ['customerEmail', 'items'],
  },
  mutating: true,
  handler: async ({ customerEmail, items, notes }) => {
    const email = String(customerEmail || '').trim()
    if (!email.includes('@')) throw new Error('customerEmail must be a valid email')

    let parsed: QuotationItemInput[]
    try {
      const raw = typeof items === 'string' ? JSON.parse(items) : items
      if (!Array.isArray(raw)) throw new Error('not an array')
      parsed = raw as QuotationItemInput[]
    } catch { throw new Error('items must be a JSON array of {productId, quantity, unitPrice?}') }
    if (parsed.length < 1 || parsed.length > 50) throw new Error('items: provide 1-50 lines')

    const productIds = parsed.map(i => String(i.productId || '')).filter(Boolean)
    if (productIds.length !== parsed.length) throw new Error('every item needs a productId')

    const products = await queryMany<{ id: string; name: string; sku: string; gst_percentage: string; hsn_code: string | null; price: string; base_price: string }>(
      `SELECT p.id::text, p.name, p.sku, COALESCE(p.gst_percentage, 18)::text AS gst_percentage,
              p.hsn_code,
              COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
              p.base_price::text
         FROM products p WHERE p.id = ANY($1::uuid[]) AND p.is_active = TRUE`,
      [productIds]
    )
    if (products.length !== new Set(productIds).size) {
      throw new Error(`Only ${products.length} of ${new Set(productIds).size} unique productIds resolved to active products`)
    }
    const pById = new Map(products.map(p => [p.id, p]))

    const customer = await queryOne<{ first_name: string | null; last_name: string | null }>(
      `SELECT first_name, last_name FROM users WHERE email = $1 LIMIT 1`, [email]
    )
    const consigneeName = customer
      ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || email
      : email

    const previewItems = parsed.map(it => {
      const p = pById.get(String(it.productId))!
      const qty = Number(it.quantity)
      if (!isFinite(qty) || qty <= 0) throw new Error(`Invalid quantity for ${p.name}`)
      const unitPrice = it.unitPrice != null && Number(it.unitPrice) > 0 ? Number(it.unitPrice) : Number(p.price)
      const gstRate = Number(p.gst_percentage) || 18
      const lineAmount = qty * unitPrice
      return { productId: p.id, name: p.name, sku: p.sku, hsnCode: p.hsn_code, gstRate, quantity: qty, unitPrice, lineAmount }
    })

    const subtotal = previewItems.reduce((s, i) => s + i.lineAmount, 0)
    const cgst = previewItems.reduce((s, i) => s + i.lineAmount * i.gstRate / 200, 0)
    const sgst = cgst
    const total = Math.round(subtotal + cgst + sgst)

    return {
      proposed: true,
      kind: 'create_quotation',
      payload: {
        customerEmail: email,
        consigneeName,
        notes: notes ? String(notes).slice(0, 500) : null,
        items: previewItems,
        subtotal: round2(subtotal),
        cgst: round2(cgst),
        sgst: round2(sgst),
        total,
      },
      confirmation: `Create draft quotation for ${consigneeName} (${email}) with ${previewItems.length} line${previewItems.length === 1 ? '' : 's'}, total ₹${fmtINR(total)}?`,
      ui_blocks: [
        { type: 'heading', value: `Quotation preview · ${consigneeName}`, level: 2 },
        {
          type: 'table',
          headers: ['Item', 'Qty', 'Unit ₹', 'Line ₹'],
          rows: previewItems.map(i => [i.name + (i.sku ? ` (${i.sku})` : ''), String(i.quantity), fmtINR(i.unitPrice), fmtINR(i.lineAmount)]),
        },
        {
          type: 'kv_pairs',
          pairs: [
            { key: 'Subtotal', value: `₹${fmtINR(subtotal)}` },
            { key: 'CGST + SGST', value: `₹${fmtINR(cgst + sgst)}` },
            { key: 'Total', value: `₹${fmtINR(total)}` },
          ],
        },
        { type: 'text', value: `${previewItems.length} line item${previewItems.length === 1 ? '' : 's'} · status will be "draft" — admin can finalise after creation.`, weight: 'muted' },
      ],
    }
  },
}

const propose_send_quotation_email: ToolDef = {
  name: 'propose_send_quotation_email',
  description: 'Propose sending the quotation PDF link to the customer. Defaults toEmail to the quotation\'s consignee_email. Admin must approve before send.',
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
      id: string; quote_number: string; status: string; consignee_email: string | null;
      consignee_name: string | null; total_amount: string; view_token: string; quote_date: string
    }>(
      `SELECT id::text, quote_number, status, consignee_email, consignee_name,
              total_amount::text, view_token::text, quote_date
         FROM quotations
        WHERE id = $1::uuid OR quote_number = $2 LIMIT 1`,
      [quotationId || '00000000-0000-0000-0000-000000000000', quoteNumber || '']
    )
    if (!q) throw new Error('Quotation not found')
    const recipient = String(toEmail || q.consignee_email || '').trim()
    if (!recipient.includes('@')) throw new Error('No valid recipient — pass toEmail or set consignee_email on the quotation first')
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
        { type: 'text', value: `Customer will receive the public link https://quotation.jeffistores.in/${q.view_token}.`, weight: 'muted' },
      ],
    }
  },
}

const propose_mark_invoice_paid: ToolDef = {
  name: 'propose_mark_invoice_paid',
  description: 'Propose marking an invoice (an order with invoice_number) as paid. Records payment_mode and an optional paidAt date. Admin must approve.',
  inputSchema: {
    type: 'object',
    properties: {
      invoiceId: { type: 'string', description: 'Order UUID for the invoice.' },
      invoiceNumber: { type: 'string', description: 'Alternative to invoiceId.' },
      paymentMode: { type: 'string', description: `One of: ${PAYMENT_MODES.join(', ')}` },
      paidAt: { type: 'string', description: 'ISO date (YYYY-MM-DD). Defaults to today.' },
    },
    required: ['paymentMode'],
  },
  mutating: true,
  handler: async ({ invoiceId, invoiceNumber, paymentMode, paidAt }) => {
    if (!invoiceId && !invoiceNumber) throw new Error('Provide invoiceId or invoiceNumber')
    const mode = String(paymentMode || '').trim().toLowerCase()
    if (!PAYMENT_MODES.includes(mode)) throw new Error(`paymentMode must be one of: ${PAYMENT_MODES.join(', ')}`)
    const dateStr = String(paidAt || '').trim()
    if (dateStr && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new Error('paidAt must be YYYY-MM-DD')

    const inv = await queryOne<{
      id: string; order_number: string; invoice_number: string;
      total_amount: string; payment_status: string; customer_name: string | null
    }>(
      `SELECT id::text, order_number, invoice_number, total_amount::text, payment_status, customer_name
         FROM orders
        WHERE (id = $1::uuid OR invoice_number = $2) AND invoice_number IS NOT NULL LIMIT 1`,
      [invoiceId || '00000000-0000-0000-0000-000000000000', invoiceNumber || '']
    )
    if (!inv) throw new Error('Invoice not found')
    if (inv.payment_status === 'paid') {
      return { proposed: false, info: `Invoice ${inv.invoice_number} is already paid.` }
    }
    if (inv.payment_status === 'refunded') {
      return { proposed: false, info: `Invoice ${inv.invoice_number} is refunded — cannot mark paid.` }
    }

    return {
      proposed: true,
      kind: 'mark_invoice_paid',
      payload: {
        orderId: inv.id,
        invoiceNumber: inv.invoice_number,
        paymentMode: mode,
        paidAt: dateStr || null,
        amount: Number(inv.total_amount),
        customerName: inv.customer_name || '',
      },
      confirmation: `Mark invoice ${inv.invoice_number} (₹${fmtINR(inv.total_amount)}) as paid via ${mode}?`,
      ui_blocks: [
        { type: 'heading', value: `Mark invoice paid`, level: 2 },
        {
          type: 'kv_pairs',
          pairs: [
            { key: 'Invoice', value: inv.invoice_number },
            { key: 'Customer', value: inv.customer_name || '—' },
            { key: 'Amount', value: `₹${fmtINR(inv.total_amount)}` },
            { key: 'Payment mode', value: mode },
            { key: 'Paid on', value: dateStr || fmtDate(new Date()) },
            { key: 'Current status', value: inv.payment_status },
          ],
        },
      ],
    }
  },
}

const propose_update_order_status: ToolDef = {
  name: 'propose_update_order_status',
  description: `Propose advancing an order's status. Allowed: ${ORDER_STATUS_FLOW.join(' → ')}. Optionally attach an AWB on shipped. Replaces mark_order_shipped for richer transitions. Flags status regressions in the preview.`,
  inputSchema: {
    type: 'object',
    properties: {
      orderId: { type: 'string', description: 'Order UUID.' },
      orderNumber: { type: 'string', description: 'Alternative to orderId.' },
      newStatus: { type: 'string', description: ORDER_STATUS_FLOW.join(' | ') },
      awbNumber: { type: 'string', description: 'Optional AWB; only meaningful when newStatus is shipped.' },
    },
    required: ['newStatus'],
  },
  mutating: true,
  handler: async ({ orderId, orderNumber, newStatus, awbNumber }) => {
    if (!orderId && !orderNumber) throw new Error('Provide orderId or orderNumber')
    const status = String(newStatus || '').trim().toLowerCase()
    if (!ORDER_STATUS_FLOW.includes(status)) {
      throw new Error(`newStatus must be one of: ${ORDER_STATUS_FLOW.join(', ')}`)
    }
    const awb = awbNumber ? String(awbNumber).trim() : null
    if (awb && awb.length > 64) throw new Error('awbNumber too long (max 64)')

    const o = await queryOne<{
      id: string; order_number: string; status: string; payment_status: string;
      customer_name: string | null; total_amount: string; awb_number: string | null
    }>(
      `SELECT id::text, order_number, status, payment_status, customer_name,
              total_amount::text, awb_number
         FROM orders WHERE id = $1::uuid OR order_number = $2 LIMIT 1`,
      [orderId || '00000000-0000-0000-0000-000000000000', orderNumber || '']
    )
    if (!o) throw new Error('Order not found')
    if (o.status === status) {
      return { proposed: false, info: `Order ${o.order_number} is already in status "${status}".` }
    }

    const fromIdx = ORDER_STATUS_FLOW.indexOf(o.status)
    const toIdx = ORDER_STATUS_FLOW.indexOf(status)
    const isRegression = fromIdx >= 0 && toIdx >= 0 && toIdx < fromIdx && status !== 'cancelled'

    const blocks: Record<string, unknown>[] = [
      { type: 'heading', value: `Order ${o.order_number}: ${o.status} → ${status}`, level: 2 },
      {
        type: 'kv_pairs',
        pairs: [
          { key: 'Customer', value: o.customer_name || '—' },
          { key: 'Total', value: `₹${fmtINR(o.total_amount)}` },
          { key: 'Payment', value: o.payment_status },
          { key: 'From status', value: o.status },
          { key: 'To status', value: status },
          ...(awb ? [{ key: 'AWB', value: awb }] : []),
          ...(o.awb_number && !awb ? [{ key: 'Existing AWB', value: o.awb_number }] : []),
        ],
      },
    ]
    if (isRegression) {
      blocks.push({
        type: 'callout', tone: 'warn',
        title: 'Status regression',
        message: `Moving from "${o.status}" back to "${status}" is unusual — confirm this is intentional.`,
      })
    }
    if (status === 'shipped' && !awb && !o.awb_number) {
      blocks.push({
        type: 'callout', tone: 'info',
        message: 'Marking shipped without an AWB number — customer-facing tracking will be empty.',
      })
    }

    return {
      proposed: true,
      kind: 'update_order_status',
      payload: {
        orderId: o.id,
        orderNumber: o.order_number,
        fromStatus: o.status,
        newStatus: status,
        awbNumber: awb,
        isRegression,
      },
      confirmation: `Move order ${o.order_number} from ${o.status} → ${status}${awb ? ` with AWB ${awb}` : ''}?`,
      ui_blocks: blocks,
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
  propose_mark_invoice_paid,
  propose_update_order_status,
]
