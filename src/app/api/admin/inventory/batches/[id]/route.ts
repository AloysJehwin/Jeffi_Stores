import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, withTransaction } from '@/lib/db'
import { syncPerishableStock } from '@/lib/shelf'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const batch = await queryOne<{ id: string; product_id: string; variant_id: string | null; sub_variant_id: string | null; quantity_remaining: string }>(
      'SELECT id, product_id, variant_id, sub_variant_id, quantity_remaining FROM product_batches WHERE id = $1',
      [id]
    )
    if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

    await withTransaction(async (client) => {
      await client.query('UPDATE inventory_transactions SET batch_id = NULL WHERE batch_id = $1', [id])
      await client.query('DELETE FROM product_batches WHERE id = $1', [id])
      await syncPerishableStock(client, batch.product_id, batch.variant_id, batch.sub_variant_id)
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to delete batch' }, { status: 500 })
  }
}
