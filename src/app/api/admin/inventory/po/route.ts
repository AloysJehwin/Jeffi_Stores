import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryOne, query } from '@/lib/db'
import { round2 } from '@/lib/gst'
import { buildSearchClause } from '@/lib/search'
import { z } from 'zod'
import { parseBody, zUuid, zCurrency } from '@/lib/validate'

export const dynamic = 'force-dynamic'

const poItemSchema = z.object({
  product_id: zUuid,
  variant_id: zUuid.nullish(),
  sub_variant_id: zUuid.nullish(),
  quantity: z.coerce.number().positive(),
  unit_cost: zCurrency.optional(),
  tax_rate: z.coerce.number().min(0).default(0),
  product_name: z.string().nullish(),
  sku: z.string().nullish(),
  // purchase unit conversion (optional)
  purchase_unit: z.string().max(50).nullish(),
  purchase_unit_factor: z.coerce.number().positive().default(1),
  line_total_incl_gst: zCurrency.nullish(),
  gst_inclusive: z.boolean().default(true),
}).refine(
  d => d.unit_cost != null || d.line_total_incl_gst != null,
  { message: 'Either unit_cost or line_total_incl_gst is required' }
)

const createPOSchema = z.object({
  supplier_id: zUuid,
  items: z.array(poItemSchema).min(1),
})

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || ''
    const supplierId = searchParams.get('supplier_id') || ''
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = (page - 1) * limit

    const conditions = ['1=1']
    const params: any[] = []
    let i = 1

    if (status) { conditions.push(`po.status = $${i++}`); params.push(status) }
    if (supplierId) { conditions.push(`po.supplier_id = $${i++}`); params.push(supplierId) }
    if (search) {
      const sc = buildSearchClause(search, ['po.po_number', 's.name'], i)
      conditions.push(sc.clause)
      params.push(...sc.params)
      i = sc.nextIdx
    }

    const where = conditions.join(' AND ')
    const countRow = await queryOne<{ total: number }>(
      `SELECT COUNT(DISTINCT po.id)::int AS total
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE ${where}`,
      params
    )
    const total = countRow?.total || 0

    const rows = await queryMany<any>(
      `SELECT
         po.id, po.po_number, po.status, po.order_date, po.expected_date,
         po.subtotal, po.tax_amount, po.total_amount, po.notes, po.created_at,
         s.id AS supplier_id, s.name AS supplier_name, s.email AS supplier_email,
         COUNT(poi.id)::int AS item_count
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN purchase_order_items poi ON poi.po_id = po.id
       WHERE ${where}
       GROUP BY po.id, s.id
       ORDER BY po.created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      [...params, limit, offset]
    )

    return NextResponse.json({ purchase_orders: rows || [], total, page, limit })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const body = await request.json()

    const parsed = parseBody(createPOSchema, body, 'POST /api/admin/inventory/po')
    if (!parsed.ok) return parsed.response

    const { supplier_id, items } = parsed.data
    const { order_date, expected_date, notes, status = 'draft' } = body

    if (!supplier_id) return NextResponse.json({ error: 'supplier_id is required' }, { status: 400 })

    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const countRow = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM purchase_orders WHERE po_number LIKE $1`,
      [`PO-${datePart}-%`]
    )
    const seq = String((countRow?.cnt || 0) + 1).padStart(4, '0')
    const poNumber = `PO-${datePart}-${seq}`

    let subtotal = 0
    let taxAmount = 0
    const resolvedItems = items.map(item => {
      const factor = item.purchase_unit_factor ?? 1
      const baseQty = item.quantity * factor
      const gstRate = item.tax_rate ?? 0

      let unitCost: number
      let lineTotalInclGst: number | null = item.line_total_incl_gst ?? null

      if (lineTotalInclGst != null) {
        const totalExGst = item.gst_inclusive
          ? lineTotalInclGst / (1 + gstRate / 100)
          : lineTotalInclGst
        unitCost = totalExGst / baseQty
      } else {
        unitCost = item.unit_cost!
      }

      const lineExGst = unitCost * baseQty
      const lineTax = lineExGst * (gstRate / 100)
      subtotal += lineExGst
      taxAmount += lineTax

      return { ...item, resolvedUnitCost: unitCost, baseQty, factor }
    })
    const totalAmount = subtotal + taxAmount

    const po = await queryOne<{ id: string }>(
      `INSERT INTO purchase_orders (po_number, supplier_id, status, order_date, expected_date, notes, subtotal, tax_amount, total_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [poNumber, supplier_id, status,
       order_date || new Date().toISOString().slice(0, 10),
       expected_date || null, notes || null,
       round2(subtotal),
       round2(taxAmount),
       round2(totalAmount)]
    )

    for (const item of resolvedItems) {
      const { resolvedUnitCost, baseQty, factor } = item
      const tax = item.tax_rate ?? 0
      const total = round2(baseQty * resolvedUnitCost * (1 + tax / 100))
      await query(
        `INSERT INTO purchase_order_items
           (po_id, product_id, variant_id, product_name, sku, quantity, unit_cost, tax_rate, total_cost,
            purchase_unit, purchase_unit_factor, line_total_incl_gst, gst_inclusive)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [po?.id, item.product_id, item.variant_id || null,
         item.product_name, item.sku || null,
         baseQty,
         Math.round(resolvedUnitCost * 1000000) / 1000000,
         tax, total,
         item.purchase_unit || null,
         factor,
         item.line_total_incl_gst ?? null,
         item.gst_inclusive ?? true]
      )
    }

    return NextResponse.json({ success: true, id: po?.id, po_number: poNumber })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
