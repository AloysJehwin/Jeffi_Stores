import { NextRequest, NextResponse } from '../../next'
import { authenticateAdmin } from '../../auth'
import { hasScope } from '../../lib/scopes'
import { queryMany, queryOne, withTransaction } from '@jeffi/tenancy'
import { QUOTATIONS_ENTITY, QUOTE_SUBTOTAL_SQL, QUOTE_TOTAL_SQL, buildWhere, normalizeQuery, sortClause } from '@jeffi/list-filters'
import { z } from 'zod'
import { parseBody, zNonEmpty, zEmail } from '../../lib/validate'
import {
  draftQuotationLineSchema,
  quotationLineRow,
  quotationTotals,
  insertQuotationItem,
} from '../../lib/invoice-line-items'
import { getFeatureFlags } from '../../lib/site-controls'
import { lockBadges, lockNewDraft } from '../../lib/draft-locks'

function buildQuoteNumber(now: Date, seq: number): string {
  const month = now.getMonth()
  const year = now.getFullYear()
  const fyStart = month >= 3 ? year : year - 1
  const fy = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][month]
  return `QT/${fy}/${mon}/${seq}`
}

// A new quotation is always a draft, so its lines may be half-filled; finalising checks them.
const createQuotationSchema = z.object({
  consignee_name: zNonEmpty,
  consignee_email: zEmail.nullish(),
  items: z.array(draftQuotationLineSchema).default([]),
})

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'quotations:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const pageSize = Math.min(parseInt(searchParams.get('pageSize') || searchParams.get('limit') || '25'), 200)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const offset = (page - 1) * pageSize

    // Whitelisted server-side sort (columns/aliases available in the SELECT below).
    const orderBy = sortClause(searchParams, {
      sorts: QUOTATIONS_ENTITY.sorts ?? {},
      defaultSql: 'q.created_at DESC',
      tiebreak: 'q.created_at DESC, q.id DESC',
    })

    const { where, params, nextIdx: i } = buildWhere(QUOTATIONS_ENTITY, normalizeQuery(QUOTATIONS_ENTITY, searchParams))

    const countRow = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM quotations q ${where}`,
      params
    )
    const total = parseInt(countRow?.total || '0', 10)

    const dataParams = [...params, pageSize, offset]
    const rows = await queryMany(
      `SELECT q.id, q.quote_number, q.quote_date, q.status, q.consignee_name, q.consignee_addr1, q.consignee_addr2,
              q.consignee_city, q.consignee_state, q.consignee_gstin, q.consignee_phone, q.consignee_pincode,
              q.consignee_email, q.buyer_same, q.buyer_name, q.buyer_addr1, q.buyer_addr2, q.buyer_city, q.buyer_state,
              q.buyer_gstin,
              ${QUOTE_SUBTOTAL_SQL} AS subtotal,
              ${QUOTE_TOTAL_SQL} AS total_amount,
              q.cgst_amount, q.sgst_amount, q.converted_order_id,
              q.view_token, q.created_at,
              EXISTS(SELECT 1 FROM business_rfqs WHERE converted_quotation_id = q.id) AS from_rfq
       FROM quotations q ${where} ${orderBy} LIMIT $${i} OFFSET $${i + 1}`,
      dataParams
    )
    const locks = await lockBadges(admin, 'quotation', (rows || []).filter((r: any) => r.status === 'draft').map((r: any) => r.id))
    const withLocks = (rows || []).map((r: any) => (locks[r.id] ? { ...r, lock: locks[r.id] } : r))
    return NextResponse.json({ quotations: withLocks, total, page, pageSize })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'quotations:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const body = await request.json()

    const parsed = parseBody(createQuotationSchema, body, 'POST /api/admin/quotations')
    if (!parsed.ok) return parsed.response

    // Use validated items from parsed.data; merge raw body for non-validated fields (addresses, dates, etc.)
    const { items } = parsed.data
    const fields = { ...body, items: undefined }

    const { gstEnabled } = await getFeatureFlags()
    // Server computes amounts (rate is per base piece; count units scale by factor).
    const rows = items.map(item => quotationLineRow(item, gstEnabled))
    const totals = quotationTotals(rows)

    const now = new Date()
    const month = now.getMonth()
    const year = now.getFullYear()
    const fyStart = month >= 3 ? year : year - 1
    const fy = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`
    const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][month]
    const prefix = `QT/${fy}/${mon}/`

    const maxRow = await queryOne<{ max_seq: string | null }>(
      `SELECT MAX(CAST(split_part(quote_number, '/', 4) AS INTEGER)) AS max_seq
       FROM quotations WHERE quote_number LIKE $1`,
      [prefix + '%']
    )
    const seq = (parseInt(maxRow?.max_seq || '0') || 0) + 1
    const quoteNumber = buildQuoteNumber(now, seq)
    const { storeOrigin } = await import('../../lib/brand')
    const storeState = (await storeOrigin()).state

    const { qt, savedItems } = await withTransaction(async client => {
      const qt = (
        await client.query(
          `INSERT INTO quotations (
        quote_number, quote_date, status,
        consignee_name, consignee_addr1, consignee_addr2, consignee_city, consignee_state, consignee_gstin,
        consignee_phone, consignee_pincode, consignee_email,
        buyer_same, buyer_name, buyer_addr1, buyer_addr2, buyer_city, buyer_state, buyer_gstin,
        buyer_phone, buyer_pincode, buyer_email,
        notes, subtotal, cgst_amount, sgst_amount, total_amount, created_by
      ) VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
      RETURNING *`,
          [
            quoteNumber,
            fields.quote_date || now.toISOString().slice(0, 10),
            fields.consignee_name || '',
            fields.consignee_addr1 || '',
            fields.consignee_addr2 || null,
            fields.consignee_city || '',
            fields.consignee_state || storeState,
            fields.consignee_gstin || null,
            fields.consignee_phone || null,
            fields.consignee_pincode || null,
            fields.consignee_email || null,
            fields.buyer_same !== false,
            fields.buyer_name || null,
            fields.buyer_addr1 || null,
            fields.buyer_addr2 || null,
            fields.buyer_city || null,
            fields.buyer_state || null,
            fields.buyer_gstin || null,
            fields.buyer_phone || null,
            fields.buyer_pincode || null,
            fields.buyer_email || null,
            fields.notes || null,
            totals.subtotal,
            totals.cgst_amount,
            totals.sgst_amount,
            totals.total_amount,
            admin.adminId,
          ]
        )
      ).rows[0]

      for (let idx = 0; idx < rows.length; idx++) {
        await insertQuotationItem(client, qt.id, idx, rows[idx])
      }
      const savedItems = (
        await client.query(`SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY position`, [qt.id])
      ).rows
      return { qt, savedItems }
    })
    await lockNewDraft(admin, 'quotation', qt.id)
    return NextResponse.json({ quotation: qt, items: savedItems }, { status: 201 })
  } catch (e: any) {
    console.error('[admin/quotations POST] failed', e)
    return NextResponse.json({ error: e?.message || 'Failed to create quotation' }, { status: 500 })
  }
}
