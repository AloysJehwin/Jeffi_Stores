import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const productId = params.id

    const allowedFields: Record<string, unknown> = {}
    if (typeof body.is_active === 'boolean') allowedFields.is_active = body.is_active
    if (typeof body.is_featured === 'boolean') allowedFields.is_featured = body.is_featured

    if (Object.keys(allowedFields).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    // Enforce max 6 featured products
    if (allowedFields.is_featured === true) {
      const count = await queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM products WHERE is_featured = true AND id != $1`,
        [productId]
      )
      if (Number(count?.count ?? 0) >= 6) {
        return NextResponse.json(
          { error: 'Maximum 6 featured products allowed. Unfeature another product first.' },
          { status: 409 }
        )
      }
    }

    const keys = Object.keys(allowedFields)
    const values = Object.values(allowedFields)
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ')

    const updated = await queryOne(
      `UPDATE products SET ${setClause}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING id`,
      [...values, productId]
    )

    if (!updated) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to update product' }, { status: 500 })
  }
}

export async function DELETE() {
  return NextResponse.json(
    { error: 'Products cannot be deleted. Set is_active = false to deactivate.' },
    { status: 405 }
  )
}
