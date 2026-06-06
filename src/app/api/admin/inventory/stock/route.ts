import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getStockLedger, getStockValuation, logStockMovement } from '@/lib/inventory'
import { getClient, queryOne } from '@/lib/db'
import { logAdminAudit } from '@/lib/admin-audit'
import { parseBody, zUuid } from '@/lib/validate'

const PatchSchema = z.object({
  product_id: zUuid,
  variant_id: zUuid.nullish(),
  sub_variant_id: zUuid.nullish(),
  new_quantity: z.coerce.number().min(0),
  notes: z.string().nullish(),
})

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const view = searchParams.get('view') || 'ledger'

    if (view === 'valuation') {
      const data = await getStockValuation()
      return NextResponse.json(data)
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
    if (!hasScope(admin.role, admin.scopes, 'inventory')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const raw = await request.json().catch(() => null)
    if (!raw) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    const parsed = parseBody(PatchSchema, raw, 'PATCH /api/admin/inventory/stock')
    if (!parsed.ok) return parsed.response
    const { product_id, variant_id, sub_variant_id, new_quantity, notes } = parsed.data

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

      const change = new_quantity - currentQty

      if (sub_variant_id) {
        await client.query('UPDATE product_sub_variants SET inventory_quantity = $1 WHERE id = $2', [new_quantity, sub_variant_id])
      } else if (variant_id) {
        await client.query('UPDATE product_variants SET inventory_quantity = $1 WHERE id = $2', [new_quantity, variant_id])
      } else {
        await client.query('UPDATE products SET inventory_quantity = $1 WHERE id = $2', [new_quantity, product_id])
      }

      await logStockMovement(client, {
        productId: product_id,
        variantId: variant_id || null,
        subVariantId: sub_variant_id || null,
        transactionType: 'adjustment',
        quantityChange: change,
        referenceType: 'manual',
        referenceId: product_id,
        currentStock: currentQty,
        notes: notes || `Manual adjustment to ${new_quantity}`,
      })

      await client.query('COMMIT')

      const product = await queryOne<{ name: string }>('SELECT name FROM products WHERE id = $1', [product_id])
      logAdminAudit({
        adminId: admin.adminId,
        action: 'inventory_adjust',
        entityType: 'inventory',
        entityId: product_id,
        summary: `Adjusted stock for "${product?.name || 'product'}" from ${currentQty} to ${new_quantity}${sub_variant_id ? ' (sub-variant)' : variant_id ? ' (variant)' : ''}`,
        diff: { quantity: { from: currentQty, to: new_quantity } },
        metadata: { product_id, variant_id: variant_id || null, sub_variant_id: sub_variant_id || null, change, notes: notes || null },
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
