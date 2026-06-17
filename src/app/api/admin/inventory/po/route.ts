import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryOne, query } from '@/lib/db'
import { buildSearchClause } from '@/lib/search'
import { z } from 'zod'
import { parseBody, zUuid, zCurrency } from '@/lib/validate'

export const dynamic = 'force-dynamic'

type UnitRow = { unit: string; dimension: string; min_qty: string; max_qty: string | null; qty_step: string }

async function validatePurchaseQty(
  productId: string | null | undefined,
  variantId: string | null | undefined,
  qty: number
): Promise<string | null> {
  if (!productId && !variantId) return null
  let unit: UnitRow | null = null
  if (variantId) {
    unit = await queryOne<UnitRow>(
      `SELECT unit, dimension, min_qty, max_qty, qty_step FROM product_units
       WHERE variant_id = $1 AND is_purchase_default = TRUE LIMIT 1`,
      [variantId]
    ) ?? null
  }
  if (!unit && productId) {
    unit = await queryOne<UnitRow>(
      `SELECT unit, dimension, min_qty, max_qty, qty_step FROM product_units
       WHERE product_id = $1 AND variant_id IS NULL AND is_purchase_default = TRUE LIMIT 1`,
      [productId]
    ) ?? null
  }
  if (!unit) return null
  const min = Number(unit.min_qty ?? 1)
  const max = unit.max_qty != null ? Number(unit.max_qty) : null
  const step = Number(unit.qty_step ?? 1)
  if (qty < min) return `Quantity must be at least ${min} ${unit.unit}`
  if (max !== null && qty > max) return `Quantity cannot exceed ${max} ${unit.unit}`
  if (unit.dimension !== 'count' && step > 0) {
    const steps = Math.round((qty - min) / step)
    const snapped = Math.round((min + steps * step) * 1e6) / 1e6
    if (Math.abs(snapped - qty) > 1e-9) return `Quantity must be in steps of ${step} from ${min}`
  }
  return null
}

const poItemSchema = z.object({
  product_id: zUuid,
  variant_id: zUuid.nullish(),
  sub_variant_id: zUuid.nullish(),
  quantity: z.coerce.number().positive(),
  unit_cost: zCurrency,
  tax_rate: z.coerce.number().min(0).default(0),
  product_name: z.string().nullish(),
  sku: z.string().nullish(),
})

const createPOSchema = z.object({
  supplier_id: zUuid,
  items: z.array(poItemSchema).min(1),
})

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

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
    if (!hasScope(admin.role, admin.scopes, 'inventory')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

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
    for (const item of items) {
      const qtyErr = await validatePurchaseQty(item.product_id, item.variant_id ?? null, item.quantity)
      if (qtyErr) return NextResponse.json({ error: qtyErr }, { status: 400 })
      const qty = item.quantity
      const cost = item.unit_cost
      const tax = item.tax_rate ?? 0
      subtotal += qty * cost
      taxAmount += qty * cost * (tax / 100)
    }
    const totalAmount = subtotal + taxAmount

    const po = await queryOne<{ id: string }>(
      `INSERT INTO purchase_orders (po_number, supplier_id, status, order_date, expected_date, notes, subtotal, tax_amount, total_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [poNumber, supplier_id, status,
       order_date || new Date().toISOString().slice(0, 10),
       expected_date || null, notes || null,
       Math.round(subtotal * 100) / 100,
       Math.round(taxAmount * 100) / 100,
       Math.round(totalAmount * 100) / 100]
    )

    for (const item of items) {
      const qty = item.quantity
      const cost = item.unit_cost
      const tax = item.tax_rate ?? 0
      const total = Math.round(qty * cost * (1 + tax / 100) * 100) / 100
      await query(
        `INSERT INTO purchase_order_items (po_id, product_id, variant_id, product_name, sku, quantity, unit_cost, tax_rate, total_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [po?.id, item.product_id, item.variant_id || null,
         item.product_name, item.sku || null,
         qty, cost, tax, total]
      )
    }

    return NextResponse.json({ success: true, id: po?.id, po_number: poNumber })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
