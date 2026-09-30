import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'
interface Params {
  params: Promise<{ id: string }>
}

// POST — publish draft to live
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'coupons:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const draft = await queryOne<{ coupon_id: string; fields: Record<string, unknown> }>(
    `SELECT coupon_id, fields FROM coupon_drafts WHERE coupon_id = $1`,
    [id]
  )
  if (!draft) return NextResponse.json({ error: 'No draft to publish' }, { status: 404 })

  const f = draft.fields as any
  // Edit-draft publish: apply the drafted changes to the existing live coupon (COALESCE keeps
  // unset fields). Create-drafts are inactive coupons published via the create-draft publish
  // action, not this edit-draft route.
  await query(
    `UPDATE coupons SET
       code = COALESCE($2, code),
       description = $3,
       discount_type = COALESCE($4, discount_type),
       discount_value = COALESCE($5::numeric, discount_value),
       min_purchase_amount = $6::numeric,
       max_discount_amount = $7::numeric,
       usage_limit = $8::integer,
       usage_limit_per_user = $9::integer,
       valid_from = $10::timestamptz,
       valid_until = $11::timestamptz,
       is_active = COALESCE($12::boolean, is_active)
     WHERE id = $1`,
    [
      id,
      f.code || null,
      f.description ?? null,
      f.discount_type || null,
      f.discount_value != null ? f.discount_value : null,
      f.min_purchase_amount ?? null,
      f.max_discount_amount ?? null,
      f.usage_limit ?? null,
      f.usage_limit_per_user ?? null,
      f.valid_from || null,
      f.valid_until || null,
      f.is_active != null ? f.is_active : null,
    ]
  )
  await query(`DELETE FROM coupon_drafts WHERE coupon_id = $1`, [id])
  return NextResponse.json({ success: true })
}
