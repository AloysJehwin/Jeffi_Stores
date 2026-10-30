import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, queryMany } from '@/lib/shared/db'
import {
  actorOf,
  closeIfLocked,
  discardGuard,
  draftLockResponse,
  epochFrom,
  withDraftPublish,
  withDraftWrite,
  type DraftDb,
} from '@/lib/admin/draft-locks'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'review_forms:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const form = await queryOne('SELECT * FROM review_forms WHERE id = $1', [id])
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ form })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'review_forms:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json()
  const fields = [
    'title',
    'slug',
    'description',
    'template_type',
    'google_review_url',
    'coupon_id',
    'is_active',
    'is_draft',
    'custom_fields',
  ]
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1

  for (const field of fields) {
    if (field in body) {
      updates.push(`${field} = $${i++}`)
      if (field === 'slug') values.push((body[field] as string).toLowerCase().trim())
      else if (field === 'custom_fields') values.push(JSON.stringify(body[field]))
      else values.push(body[field])
    }
  }

  if (!updates.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  values.push(id)
  const sql = `UPDATE review_forms SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`
  // A body with is_draft is a create-draft save: a draft write, or its publish when false.
  let result: any[]
  try {
    if (!('is_draft' in body)) result = await queryMany(sql, values)
    else {
      const write = async (db: DraftDb) => (await db.query(sql, values)).rows
      const opts = { epoch: epochFrom(request) }
      result =
        body.is_draft === false
          ? await withDraftPublish(actorOf(admin), 'review_form', id, write, opts)
          : await withDraftWrite(actorOf(admin), 'review_form', id, write, { ...opts, ensure: true })
    }
  } catch (err) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    throw err
  }
  if (!result.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ form: result[0] })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'review_forms:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const actor = actorOf(admin)
  const denied = await discardGuard(actor, 'review_form', id)
  if (denied) return denied
  await queryOne('DELETE FROM review_forms WHERE id = $1', [id])
  await closeIfLocked(actor, 'review_form', id)
  return NextResponse.json({ success: true })
}
