import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { actorOf, draftLockResponse, epochFrom, withDraftPublish } from '@/lib/admin/draft-locks'

export const dynamic = 'force-dynamic'
interface Params {
  params: Promise<{ id: string }>
}

// POST — publish draft to live
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const draft = await queryOne<{ supplier_id: string; fields: Record<string, unknown> }>(
    `SELECT supplier_id, fields FROM supplier_drafts WHERE supplier_id = $1`,
    [id]
  )
  if (!draft) return NextResponse.json({ error: 'No draft to publish' }, { status: 404 })
  const f = draft.fields as any
  try {
    await withDraftPublish(
      actorOf(admin),
      'supplier',
      id,
      async db => {
        await db.query(
          `UPDATE suppliers SET
           name=$1, gstin=$2, contact_name=$3, phone=$4, email=$5, address=$6,
           payment_terms=$7, notes=$8, bank_name=$9, account_number=$10, ifsc=$11, upi_id=$12,
           is_active=COALESCE($13::boolean, is_active),
           updated_at=NOW()
         WHERE id=$14`,
          [
            f.name,
            f.gstin || null,
            f.contact_name || null,
            f.phone || null,
            f.email || null,
            f.address || null,
            f.payment_terms != null ? parseInt(f.payment_terms) : null,
            f.notes || null,
            f.bank_name || null,
            f.account_number || null,
            f.ifsc || null,
            f.upi_id || null,
            f.is_active != null ? f.is_active : null,
            id,
          ]
        )
        await db.query(`DELETE FROM supplier_drafts WHERE supplier_id = $1`, [id])
      },
      { epoch: epochFrom(req) }
    )
  } catch (err) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    throw err
  }
  return NextResponse.json({ success: true })
}
