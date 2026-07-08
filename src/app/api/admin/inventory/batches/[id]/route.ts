import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, withTransaction } from '@/lib/db'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const batch = await queryOne<{ id: string; quantity_remaining: string }>(
      'SELECT id, quantity_remaining FROM product_batches WHERE id = $1',
      [id]
    )
    if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

    await withTransaction(async (client) => {
      // Null out ledger references before deleting to avoid FK violation
      await client.query('UPDATE inventory_transactions SET batch_id = NULL WHERE batch_id = $1', [id])
      await client.query('DELETE FROM product_batches WHERE id = $1', [id])
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to delete batch' }, { status: 500 })
  }
}
