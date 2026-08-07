import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/jwt'
import { queryOne, query } from '@/lib/db'
import { revokeAllForPrincipal } from '@/lib/auth-sessions'
import { sendBusinessAccountApprovedEmail, sendBusinessAccountRejectedEmail } from '@/lib/email-business'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await requireAdminScope(request, 'business_customers')
  if (admin instanceof NextResponse) return admin

  const { action, rejectionNote } = await request.json()
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 })
  }

  const profile = await queryOne<{ id: string }>(
    'SELECT id FROM business_profiles WHERE user_id = $1',
    [id]
  )
  if (!profile) return NextResponse.json({ error: 'Business profile not found' }, { status: 404 })

  // Load user + company info for the email
  const userInfo = await queryOne<{ email: string; first_name: string | null; last_name: string | null; company_name: string | null }>(
    `SELECT u.email, u.first_name, u.last_name, bp.company_name
     FROM users u JOIN business_profiles bp ON bp.user_id = u.id
     WHERE u.id = $1`,
    [id]
  )

  if (action === 'approve') {
    await query(
      `UPDATE business_profiles SET approval_status='approved', approved_by=$1, approved_at=NOW(), rejection_note=NULL, updated_at=NOW() WHERE user_id=$2`,
      [admin.adminId, id]
    )
    if (userInfo?.email) {
      const name = [userInfo.first_name, userInfo.last_name].filter(Boolean).join(' ') || userInfo.email
      sendBusinessAccountApprovedEmail(userInfo.email, name, userInfo.company_name || '').catch(() => {})
    }
  } else {
    await query(
      `UPDATE business_profiles SET approval_status='rejected', approved_by=$1, approved_at=NOW(), rejection_note=$2, updated_at=NOW() WHERE user_id=$3`,
      [admin.adminId, rejectionNote || null, id]
    )
    if (userInfo?.email) {
      const name = [userInfo.first_name, userInfo.last_name].filter(Boolean).join(' ') || userInfo.email
      sendBusinessAccountRejectedEmail(userInfo.email, name, userInfo.company_name || '', rejectionNote || null).catch(() => {})
    }
  }

  // approval_status is snapshotted onto business auth_sessions at login; flipping it here
  // makes the live session stale. Revoke so the user re-logs-in with a fresh snapshot
  // (pending → approved gate, or the rejection gate). principal_id for business = users.id
  // = the [id] param. Best-effort: don't let a revoke failure break the response.
  await revokeAllForPrincipal('business', id).catch(() => {})

  return NextResponse.json({ success: true, action })
}
