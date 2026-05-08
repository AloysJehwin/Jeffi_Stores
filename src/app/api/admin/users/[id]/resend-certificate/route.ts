import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne } from '@/lib/db'
import { sendAdminCertificateEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(_request)
    if (!admin || admin.role !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const row = await queryOne<any>(
      `SELECT a.username, u.email,
              ac.serial_number, ac.expires_at, ac.p12_data, ac.p12_password, a.role
       FROM admins a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN admin_certificates ac ON ac.admin_id = a.id
       WHERE a.id = $1
       ORDER BY ac.created_at DESC
       LIMIT 1`,
      [params.id]
    )

    if (!row) return NextResponse.json({ error: 'Admin not found' }, { status: 404 })
    if (!row.p12_data) return NextResponse.json({ error: 'No certificate on file — regenerate the admin account' }, { status: 422 })

    const p12Buffer = Buffer.isBuffer(row.p12_data) ? row.p12_data : Buffer.from(row.p12_data)

    const result = await sendAdminCertificateEmail(
      row.email,
      row.username,
      p12Buffer,
      row.p12_password,
      row.serial_number,
      new Date(row.expires_at).toISOString(),
      row.role
    )

    if (!result.success) {
      return NextResponse.json({ error: 'Failed to send email' }, { status: 502 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
