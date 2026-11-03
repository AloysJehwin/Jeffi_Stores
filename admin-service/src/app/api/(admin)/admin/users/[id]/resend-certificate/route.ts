import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformOwner } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { sendCertInviteEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(_request)
    if (!admin || !isPlatformOwner(admin.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const row = await queryOne<any>(
      `SELECT COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS username, u.email,
              ac.serial_number, ac.expires_at, ac.p12_data, ac.p12_password, a.role
       FROM admins a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN admin_certificates ac ON ac.admin_id = a.id
       WHERE a.id = $1
       ORDER BY ac.created_at DESC
       LIMIT 1`,
      [id]
    )

    if (!row) return NextResponse.json({ error: 'Admin not found' }, { status: 404 })

    // Portal-only (#487): re-send the invite link. The cert lives in the portal registry; no .p12
    // is ever re-attached, so no stored blob is required.
    const result = await sendCertInviteEmail(row.email, row.username, row.role)

    if (!result.success) {
      return NextResponse.json({ error: 'Failed to send email' }, { status: 502 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
