import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, queryMany } from '@/lib/db'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const fields = ['code', 'description', 'discount_type', 'discount_value', 'min_purchase_amount', 'max_discount_amount', 'usage_limit', 'usage_limit_per_user', 'valid_from', 'valid_until', 'is_active']
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1

  for (const field of fields) {
    if (field in body) {
      updates.push(`${field} = $${i++}`)
      values.push(field === 'code' ? (body[field] as string).toUpperCase() : body[field])
    }
  }

  if (updates.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  values.push(params.id)
  const result = await queryMany(
    `UPDATE coupons SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  )
  if (!result.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ coupon: result[0] })
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const inUse = await queryOne('SELECT id FROM review_forms WHERE coupon_id = $1 LIMIT 1', [params.id])
  if (inUse) return NextResponse.json({ error: 'Coupon is used by a review form — remove it from the form first' }, { status: 409 })

  await queryOne('DELETE FROM coupons WHERE id = $1', [params.id])
  return NextResponse.json({ success: true })
}
