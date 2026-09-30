import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const productId = request.nextUrl.searchParams.get('product_id')
    const variantId = request.nextUrl.searchParams.get('variant_id') || null
    const subVariantId = request.nextUrl.searchParams.get('sub_variant_id') || null

    if (!productId) return NextResponse.json({ error: 'product_id required' }, { status: 400 })

    const serials = await queryMany<{ serial_number: string; batch_id: string | null; lot_number: string | null }>(
      `SELECT ps.serial_number, ps.batch_id, pb.lot_number
       FROM product_serials ps
       LEFT JOIN product_batches pb ON pb.id = ps.batch_id
       WHERE ps.product_id = $1
         AND (ps.variant_id = $2 OR ($2::uuid IS NULL AND ps.variant_id IS NULL))
         AND (ps.sub_variant_id = $3 OR ($3::uuid IS NULL AND ps.sub_variant_id IS NULL))
         AND ps.status = 'in_stock'
         AND (pb.expiry_date IS NULL OR pb.expiry_date >= CURRENT_DATE)
       ORDER BY pb.expiry_date ASC NULLS LAST, ps.grn_id, ps.receive_seq ASC NULLS LAST, ps.created_at ASC`,
      [productId, variantId, subVariantId]
    )

    return NextResponse.json({ serials })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
