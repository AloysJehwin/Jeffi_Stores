import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/jwt'
import { queryOne, query } from '@/lib/db'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdminScope(request, 'business_customers')
  if (admin instanceof NextResponse) return admin

  const { action, rejectionNote } = await request.json()
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 })
  }

  const profile = await queryOne<{ id: string }>(
    'SELECT id FROM business_profiles WHERE user_id = $1',
    [params.id]
  )
  if (!profile) return NextResponse.json({ error: 'Business profile not found' }, { status: 404 })

  if (action === 'approve') {
    await query(
      `UPDATE business_profiles SET approval_status='approved', approved_by=$1, approved_at=NOW(), rejection_note=NULL, updated_at=NOW() WHERE user_id=$2`,
      [admin.adminId, params.id]
    )
  } else {
    await query(
      `UPDATE business_profiles SET approval_status='rejected', approved_by=$1, approved_at=NOW(), rejection_note=$2, updated_at=NOW() WHERE user_id=$3`,
      [admin.adminId, rejectionNote || null, params.id]
    )
  }

  return NextResponse.json({ success: true, action })
}
