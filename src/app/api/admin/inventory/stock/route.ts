import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getStockLedger, getStockValuation, logStockMovement } from '@/lib/inventory'
import { getClient, queryOne, query } from '@/lib/db'
import { getOrCreateOpenShelf, upsertShelfStock } from '@/lib/shelf'
import { logAdminAudit } from '@/lib/admin-audit'
import { parseBody, zUuid } from '@/lib/validate'

const PatchSchema = z.object({
  product_id: zUuid,
  variant_id: zUuid.nullish(),
  sub_variant_id: zUuid.nullish(),
  // Either supply new_quantity (base units, legacy) OR unit_id + quantity_in_unit (unit-aware)
  new_quantity: z.coerce.number().min(0).optional(),
  unit_id: zUuid.nullish(),
  quantity_in_unit: z.coerce.number().positive().optional(),
  notes: z.string().nullish(),
  warehouse_id: zUuid.nullish(),
  location_id: zUuid.nullish(),
}).refine(d => d.new_quantity !== undefined || (d.unit_id && d.quantity_in_unit !== undefined), {
  message: 'Provide either new_quantity or both unit_id and quantity_in_unit',
})

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const view = searchParams.get('view') || 'ledger'

    if (view === 'batch_valuation') {
      const search = searchParams.get('search') || ''
      const stockStatus = searchParams.get('stock_status') || ''
      const productId = searchParams.get('product_id') || ''
      const variantId = searchParams.get('variant_id') || ''
      const subVariantId = searchParams.get('sub_variant_id') || ''
      const conditions: string[] = ['pb.quantity_remaining > 0']
      const params: any[] = []
      let i = 1
      if (productId) { conditions.push(`pb.product_id = $${i++}`); params.push(productId) }
      if (variantId) { conditions.push(`pb.variant_id = $${i++}`); params.push(variantId) }
      if (subVariantId) { conditions.push(`pb.sub_variant_id = $${i++}`); params.push(subVariantId) }
      if (search) {
        conditions.push(`(p.name ILIKE $${i} OR p.sku ILIKE $${i} OR pv.variant_name ILIKE $${i} OR pb.lot_number ILIKE $${i})`)
        params.push(`%${search}%`); i++
      }
      if (stockStatus === 'expired') conditions.push(`pb.expiry_date < CURRENT_DATE`)
      if (stockStatus === 'expiring_soon') conditions.push(`pb.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`)
      const where = conditions.join(' AND ')
      const rows = await import('@/lib/db').then(m => m.queryMany<any>(`
        SELECT
          pb.id AS batch_id,
          pb.lot_number,
          pb.expiry_date,
          pb.manufacture_date,
          pb.quantity_remaining,
          pb.created_at,
          p.id AS product_id,
          p.name AS product_name,
          p.sku AS product_sku,
          p.serialized,
          ROUND(COALESCE(pv.price, p.base_price, 0) / (1 + COALESCE(p.gst_percentage, 0) / 100), 2) AS unit_cost,
          pv.id AS variant_id,
          pv.variant_name,
          sl.display_code AS location,
          CASE WHEN p.serialized THEN (
            SELECT COALESCE(json_agg(ps.serial_number ORDER BY ps.serial_number), '[]'::json)
            FROM product_serials ps
            WHERE ps.batch_id = pb.id AND ps.status = 'in_stock'
          ) ELSE '[]'::json END AS serials
        FROM product_batches pb
        JOIN products p ON p.id = pb.product_id
        LEFT JOIN product_variants pv ON pv.id = pb.variant_id
        LEFT JOIN shelf_locations sl ON sl.id = pb.location_id
        WHERE ${where}
        ORDER BY pb.expiry_date ASC NULLS LAST, p.name, pv.variant_name
      `, params))
      return NextResponse.json({ batches: rows || [] })
    }

    if (view === 'valuation') {
      const valPage = Math.max(1, parseInt(searchParams.get('page') || '1'))
      const valLimit = parseInt(searchParams.get('limit') || '50')
      const data = await getStockValuation({
        limit: valLimit,
        offset: (valPage - 1) * valLimit,
        search: searchParams.get('search') || undefined,
        categoryName: searchParams.get('category') || undefined,
        brandName: searchParams.get('brand') || undefined,
        stockStatus: searchParams.get('stock_status') || undefined,
      })
      return NextResponse.json({ ...data, page: valPage, limit: valLimit })
    }

    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = parseInt(searchParams.get('limit') || '50')
    const ledger = await getStockLedger({
      productId: searchParams.get('product_id') || undefined,
      search: searchParams.get('search') || undefined,
      from: searchParams.get('from') || undefined,
      to: searchParams.get('to') || undefined,
      limit,
      offset: (page - 1) * limit,
    })

    return NextResponse.json({ transactions: ledger.rows, total: ledger.total, page, limit })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const raw = await request.json().catch(() => null)
    if (!raw) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    const parsed = parseBody(PatchSchema, raw, 'PATCH /api/admin/inventory/stock')
    if (!parsed.ok) return parsed.response
    const { product_id, variant_id, sub_variant_id, notes } = parsed.data

    // Resolve unit context when unit_id is provided
    let unitId: string | null = null
    let unitLabel: string | null = null
    let unitFactor = 1
    let quantityInUnit: number | null = null

    if (parsed.data.unit_id && parsed.data.quantity_in_unit !== undefined) {
      const unitRow = await queryOne<{ id: string; factor: string; display_label: string | null; unit: string; dimension: string }>(
        'SELECT id, factor, display_label, unit, dimension FROM product_units WHERE id = $1', [parsed.data.unit_id]
      )
      if (!unitRow) return NextResponse.json({ error: 'Unit not found' }, { status: 400 })
      unitId = unitRow.id
      unitLabel = unitRow.display_label || unitRow.unit
      unitFactor = parseFloat(unitRow.factor as any) || 1
      quantityInUnit = parsed.data.quantity_in_unit
    }

    const client = await getClient()
    try {
      await client.query('BEGIN')

      let currentQty: number
      if (sub_variant_id) {
        const cur = await client.query<{ inventory_quantity: number }>(
          'SELECT inventory_quantity FROM product_sub_variants WHERE id = $1', [sub_variant_id])
        currentQty = parseFloat(cur.rows[0]?.inventory_quantity as any) || 0
      } else if (variant_id) {
        const cur = await client.query<{ inventory_quantity: number }>(
          'SELECT inventory_quantity FROM product_variants WHERE id = $1', [variant_id])
        currentQty = parseFloat(cur.rows[0]?.inventory_quantity as any) || 0
      } else {
        const cur = await client.query<{ inventory_quantity: number }>(
          'SELECT inventory_quantity FROM products WHERE id = $1', [product_id])
        currentQty = parseFloat(cur.rows[0]?.inventory_quantity as any) || 0
      }

      // Compute new base-unit quantity
      // Unit-aware: operator enters qty in sell unit → convert to base units via factor
      // Legacy: operator enters base units directly
      const newQuantityBase = quantityInUnit !== null
        ? Math.round(quantityInUnit * unitFactor * 1000) / 1000
        : parsed.data.new_quantity!
      const change = Math.round((newQuantityBase - currentQty) * 1000) / 1000

      if (sub_variant_id) {
        await client.query('UPDATE product_sub_variants SET inventory_quantity = $1 WHERE id = $2', [newQuantityBase, sub_variant_id])
      } else if (variant_id) {
        await client.query('UPDATE product_variants SET inventory_quantity = $1 WHERE id = $2', [newQuantityBase, variant_id])
      } else {
        await client.query('UPDATE products SET inventory_quantity = $1 WHERE id = $2', [newQuantityBase, product_id])
      }

      const autoNote = quantityInUnit !== null
        ? `Manual adjustment: ${quantityInUnit} ${unitLabel} = ${newQuantityBase} base units`
        : `Manual adjustment to ${newQuantityBase}`

      await logStockMovement(client, {
        productId: product_id,
        variantId: variant_id || null,
        subVariantId: sub_variant_id || null,
        transactionType: 'adjustment',
        quantityChange: change,
        referenceType: 'manual',
        referenceId: product_id,
        currentStock: currentQty,
        notes: notes || autoNote,
        unitId,
        unitLabel,
        unitFactor: unitFactor !== 1 ? unitFactor : null,
        quantityInUnit,
      })

      await client.query('COMMIT')

      // Assign to shelf when warehouse provided (non-perishable/serialized — those use syncPerishableStock)
      if (parsed.data.warehouse_id) {
        const wRow = await queryOne<{ code: string; perishable: boolean; serialized: boolean }>(
          `SELECT w.code, p.perishable, p.serialized
           FROM warehouses w, products p WHERE w.id = $1 AND p.id = $2`,
          [parsed.data.warehouse_id, product_id]
        )
        if (wRow && !wRow.perishable && !wRow.serialized) {
          const locationId = parsed.data.location_id ||
            await getOrCreateOpenShelf(parsed.data.warehouse_id, wRow.code)
          // Remove stock from any other locations for this product/variant (reassignment)
          await queryOne(
            `DELETE FROM shelf_stock
             WHERE product_id = $1
               AND (variant_id = $2 OR ($2 IS NULL AND variant_id IS NULL))
               AND (sub_variant_id = $3 OR ($3 IS NULL AND sub_variant_id IS NULL))
               AND location_id != $4`,
            [product_id, variant_id ?? null, sub_variant_id ?? null, locationId]
          )
          await upsertShelfStock({ query }, {
            locationId,
            productId: product_id,
            variantId: variant_id ?? null,
            subVariantId: sub_variant_id ?? null,
            quantity: newQuantityBase,
            mode: 'set',
          })
        }
      }

      const product = await queryOne<{ name: string }>('SELECT name FROM products WHERE id = $1', [product_id])
      logAdminAudit({
        adminId: admin.adminId,
        action: 'inventory_adjust',
        entityType: 'inventory',
        entityId: product_id,
        summary: `Adjusted stock for "${product?.name || 'product'}" from ${currentQty} to ${newQuantityBase}${quantityInUnit !== null ? ` (entered ${quantityInUnit} ${unitLabel})` : ''}${sub_variant_id ? ' (sub-variant)' : variant_id ? ' (variant)' : ''}`,
        diff: { quantity: { from: currentQty, to: newQuantityBase } },
        metadata: { product_id, variant_id: variant_id || null, sub_variant_id: sub_variant_id || null, change, unit_id: unitId, quantity_in_unit: quantityInUnit, notes: notes || null },
        request,
      }).catch(() => {})

      return NextResponse.json({ success: true })
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
