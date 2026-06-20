import { NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import { NextRequest } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) {
      return NextResponse.json({ error: 'Download token required' }, { status: 400 })
    }

    const cert = await queryOne(
      `SELECT ac.*, a.username
       FROM admin_certificates ac
       JOIN admins a ON ac.admin_id = a.id
       WHERE ac.download_token = $1`,
      [token]
    )

    if (!cert) {
      return new NextResponse('Certificate not found', { status: 404 })
    }

    if (cert.downloaded_at) {
      return new NextResponse('Certificate has already been downloaded. Contact a super admin to regenerate.', { status: 410 })
    }

    if (cert.is_revoked) {
      return new NextResponse('Certificate has been revoked', { status: 410 })
    }

    await queryOne(
      'UPDATE admin_certificates SET downloaded_at = NOW() WHERE id = $1 RETURNING id',
      [cert.id]
    )

    return NextResponse.json({
      message: 'Certificate marked as downloaded. The certificate file was provided during admin creation.',
      serialNumber: cert.serial_number,
      commonName: cert.common_name,
      expiresAt: cert.expires_at,
    })
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
