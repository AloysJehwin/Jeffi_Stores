import { NextRequest, NextResponse } from 'next/server'
import { query, queryCount } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const brandId = params.id

    const productCount = await queryCount(
      'SELECT COUNT(*) FROM products WHERE brand_id = $1',
      [brandId]
    )

    if (productCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete brand. It has ${productCount} product(s) assigned to it.` },
        { status: 400 }
      )
    }

    await query('DELETE FROM brands WHERE id = $1', [brandId])

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to delete brand' },
      { status: 500 }
    )
  }
}
