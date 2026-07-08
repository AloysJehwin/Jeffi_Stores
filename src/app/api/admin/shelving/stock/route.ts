import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getStockAtLocation, getStockForProduct, adjustStock, moveStock, getBatchesAtLocation } from '@/lib/shelf'
import { queryOne } from '@/lib/db'

async function getInventoryQuantity(productId: string, variantId: string | null, subVariantId: string | null): Promise<number> {
  if (subVariantId) {
    const row = await queryOne<{ q: string }>(
      `SELECT COALESCE(inventory_quantity, 0)::text AS q FROM product_sub_variants WHERE id = $1`,
      [subVariantId]
    )
    return Number(row?.q ?? 0)
  }
  if (variantId) {
    const row = await queryOne<{ q: string }>(
      `SELECT COALESCE(inventory_quantity, 0)::text AS q FROM product_variants WHERE id = $1`,
      [variantId]
    )
    return Number(row?.q ?? 0)
  }
  const row = await queryOne<{ q: string }>(
    `SELECT COALESCE(inventory_quantity, 0)::text AS q FROM products WHERE id = $1`,
    [productId]
  )
  return Number(row?.q ?? 0)
}

async function getTotalShelfStock(productId: string, variantId: string | null, subVariantId: string | null): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(quantity), 0)::text AS total FROM shelf_stock
     WHERE product_id = $1
       AND ($2::uuid IS NULL OR variant_id = $2)
       AND ($3::uuid IS NULL OR sub_variant_id = $3)`,
    [productId, variantId, subVariantId]
  )
  return Number(row?.total ?? 0)
}

export const dynamic = 'force-dynamic'

async function resolveProductId(productId: string, variantId: string | null, subVariantId: string | null): Promise<string> {
  if (productId) return productId
  if (subVariantId) {
    const row = await queryOne<{ product_id: string }>(
      `SELECT p.id AS product_id FROM product_sub_variants ps
       JOIN product_variants pv ON pv.id = ps.variant_id
       JOIN products p ON p.id = pv.product_id
       WHERE ps.id = $1`,
      [subVariantId]
    )
    if (!row) throw new Error('Sub-variant not found')
    return row.product_id
  }
  if (variantId) {
    const row = await queryOne<{ product_id: string }>(
      `SELECT product_id FROM product_variants WHERE id = $1`,
      [variantId]
    )
    if (!row) throw new Error('Variant not found')
    return row.product_id
  }
  throw new Error('product_id, variant_id, or sub_variant_id required')
}

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory:read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const locationId = request.nextUrl.searchParams.get('location_id')
    const productId = request.nextUrl.searchParams.get('product_id')
    const variantId = request.nextUrl.searchParams.get('variant_id') || null
    const subVariantId = request.nextUrl.searchParams.get('sub_variant_id') || null

    if (productId) {
      const locations = await getStockForProduct(productId, variantId, subVariantId)
      return NextResponse.json({ locations })
    }
    if (!locationId) return NextResponse.json({ error: 'location_id or product_id required' }, { status: 400 })
    const [stock, batches] = await Promise.all([
      getStockAtLocation(locationId),
      getBatchesAtLocation(locationId),
    ])
    // attach batches to matching stock rows
    const stockWithBatches = stock.map(s => ({
      ...s,
      batches: batches.filter(b =>
        b.product_id === s.product_id &&
        (b.variant_id ?? null) === (s.variant_id ?? null) &&
        (b.sub_variant_id ?? null) === (s.sub_variant_id ?? null)
      ),
    }))
    return NextResponse.json({ stock: stockWithBatches })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory:write')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = await request.json()
    const { action } = body

    if (action === 'move') {
      const { from_location_id, to_location_id, product_id, variant_id, sub_variant_id, quantity } = body
      if (!from_location_id || !to_location_id) {
        return NextResponse.json({ error: 'from_location_id, to_location_id required' }, { status: 400 })
      }
      const qty = parseInt(quantity) || 0
      if (qty <= 0) return NextResponse.json({ error: 'quantity must be positive' }, { status: 400 })

      const resolvedProductId = await resolveProductId(product_id || '', variant_id || null, sub_variant_id || null)
      await moveStock(from_location_id, to_location_id, resolvedProductId, variant_id || null, sub_variant_id || null, qty, admin.id)
      return NextResponse.json({ ok: true })
    }

    const { location_id, product_id, variant_id, sub_variant_id, quantity_change, reason } = body
    if (!location_id) {
      return NextResponse.json({ error: 'location_id required' }, { status: 400 })
    }
    const change = parseInt(quantity_change)
    if (isNaN(change)) return NextResponse.json({ error: 'quantity_change must be a number' }, { status: 400 })

    const resolvedProductId = await resolveProductId(product_id || '', variant_id || null, sub_variant_id || null)

    if (change > 0) {
      const inventoryQty = await getInventoryQuantity(resolvedProductId, variant_id || null, sub_variant_id || null)
      const currentShelfTotal = await getTotalShelfStock(resolvedProductId, variant_id || null, sub_variant_id || null)
      if (currentShelfTotal + change > inventoryQty) {
        const available = Math.max(0, inventoryQty - currentShelfTotal)
        return NextResponse.json({
          error: `Cannot assign ${change} unit(s) — only ${available} unallocated unit(s) available (inventory: ${inventoryQty}, already on shelves: ${currentShelfTotal})`
        }, { status: 409 })
      }
    }

    const stock = await adjustStock(
      location_id, resolvedProductId,
      variant_id || null, sub_variant_id || null,
      change, reason || 'adjustment', admin.id
    )
    return NextResponse.json({ stock })
  } catch (e: any) {
    if (e.message?.includes('Insufficient')) return NextResponse.json({ error: e.message }, { status: 409 })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
