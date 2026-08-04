import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'

export const dynamic = 'force-dynamic'
interface Params { params: Promise<{ id: string }> }

// POST — publish draft to live
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'review_forms:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const draft = await queryOne<{ form_id: string; fields: Record<string, unknown> }>(
    `SELECT form_id, fields FROM review_form_drafts WHERE form_id = $1`, [id]
  )
  if (!draft) return NextResponse.json({ error: 'No draft to publish' }, { status: 404 })

  const f = draft.fields as any
  await query(
    `UPDATE review_forms SET
       title = COALESCE($2, title),
       slug = COALESCE($3, slug),
       template_type = COALESCE($4, template_type),
       google_review_url = COALESCE($5, google_review_url),
       coupon_id = $6::uuid,
       description = $7,
       is_active = COALESCE($8::boolean, is_active),
       custom_fields = COALESCE($9::jsonb, custom_fields)
     WHERE id = $1`,
    [
      id,
      f.title || null,
      f.slug || null,
      f.template_type || null,
      f.google_review_url || null,
      f.coupon_id || null,
      f.description ?? null,
      f.is_active != null ? f.is_active : null,
      f.custom_fields ? JSON.stringify(f.custom_fields) : null,
    ]
  )
  await query(`DELETE FROM review_form_drafts WHERE form_id = $1`, [id])
  return NextResponse.json({ success: true })
}
