import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'
import {
  actorOf,
  draftLockResponse,
  epochFrom,
  withDraftPublish,
  withDraftWrite,
  type DraftDb,
} from '@/lib/admin/draft-locks'
import { deleteCouponRow, discardReply } from '@/lib/admin/discard-rows'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'coupons:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json()
  const fields = [
    'code',
    'description',
    'discount_type',
    'discount_value',
    'min_purchase_amount',
    'max_discount_amount',
    'usage_limit',
    'usage_limit_per_user',
    'valid_from',
    'valid_until',
    'is_active',
    'is_draft',
  ]
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
  const sql = `UPDATE coupons SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`
  // A body with is_draft is a create-draft save: a draft write, or its publish when false.
  let result: any[]
  try {
    if (!('is_draft' in body)) result = await queryMany(sql, values)
    else {
      const write = async (db: DraftDb) => (await db.query(sql, values)).rows
      const opts = { epoch: epochFrom(request) }
      result =
        body.is_draft === false
          ? await withDraftPublish(actorOf(admin), 'coupon', id, write, opts)
          : await withDraftWrite(actorOf(admin), 'coupon', id, write, { ...opts, ensure: true })
    }
  } catch (err) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    throw err
  }
  if (!result.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ coupon: result[0] })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'coupons:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  return discardReply(await deleteCouponRow(actorOf(admin), id))
}
