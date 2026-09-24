import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne, queryMany } from '@/lib/db'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'coupons:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json()
  const fields = ['code', 'description', 'discount_type', 'discount_value', 'min_purchase_amount', 'max_discount_amount', 'usage_limit', 'usage_limit_per_user', 'valid_from', 'valid_until', 'is_active', 'is_draft']
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

  values.push(id)
  const result = await queryMany(
    `UPDATE coupons SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  )
  if (!result.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ coupon: result[0] })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'coupons:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const inUse = await queryOne('SELECT id FROM review_forms WHERE coupon_id = $1 LIMIT 1', [id])
  if (inUse) return NextResponse.json({ error: 'Coupon is used by a review form — remove it from the form first' }, { status: 409 })

  // Unlink from campaigns before deleting to avoid FK violation
  await query('UPDATE campaigns SET coupon_id = NULL WHERE coupon_id = $1', [id])
  await queryOne('DELETE FROM coupons WHERE id = $1', [id])
  return NextResponse.json({ success: true })
}
