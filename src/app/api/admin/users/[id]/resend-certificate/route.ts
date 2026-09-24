import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { isPlatformOwner } from '@/lib/scopes'
import { queryOne } from '@/lib/db'
import { sendAdminCertificateEmail, sendCertInviteEmail } from '@/lib/email'
import { certDeliveryMode } from '@/lib/cert-delivery'

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

    // Portal (hard-cutover) mode re-sends the invite link and needs no stored blob — the cert lives
    // in the portal registry. Legacy/transition modes re-attach the stored p12, which must exist.
    const portal = certDeliveryMode() === 'portal'
    if (!portal && !row.p12_data) {
      return NextResponse.json({ error: 'No certificate on file — regenerate the admin account' }, { status: 422 })
    }
    const result = portal
      ? await sendCertInviteEmail(row.email, row.username, row.role)
      : await sendAdminCertificateEmail(
          row.email, row.username,
          Buffer.isBuffer(row.p12_data) ? row.p12_data : Buffer.from(row.p12_data),
          row.p12_password, row.serial_number, new Date(row.expires_at).toISOString(), row.role
        )

    if (!result.success) {
      return NextResponse.json({ error: 'Failed to send email' }, { status: 502 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
