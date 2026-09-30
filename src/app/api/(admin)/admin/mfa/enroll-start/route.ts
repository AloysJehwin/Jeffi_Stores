import { NextResponse } from 'next/server'
import { queryOne } from '@/lib/shared/db'
import { generateTotpSecret, buildOtpauthUrl, verifyMfaTicket } from '@/lib/auth/mfa'
import QRCode from 'qrcode'

export async function POST(request: Request) {
  try {
    const { ticket } = await request.json()
    if (!ticket) return NextResponse.json({ error: 'Missing ticket' }, { status: 400 })

    const t = await verifyMfaTicket(ticket, 'enroll')
    if (!t) return NextResponse.json({ error: 'Invalid or expired ticket' }, { status: 401 })

    const admin = await queryOne<{ id: string; email: string | null; mfa_enabled: boolean }>(
      `SELECT a.id, u.email, a.mfa_enabled
         FROM admins a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.id = $1 AND a.is_active = true`,
      [t.adminId]
    )
    if (!admin) return NextResponse.json({ error: 'Admin not found' }, { status: 404 })
    if (admin.mfa_enabled) return NextResponse.json({ error: 'Already enrolled' }, { status: 400 })

    const secret = await generateTotpSecret()
    // The store being administered, so a tenant owner sees their own name in the app.
    const { getStoreIdentity } = await import('@/lib/catalog/site-controls')
    const storeName = await getStoreIdentity()
      .then(i => i.name)
      .catch(() => '')
    const otpauthUrl = await buildOtpauthUrl(
      admin.email || admin.id,
      secret,
      storeName ? `${storeName} Admin` : undefined
    )
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 240 })

    return NextResponse.json({
      secret,
      otpauth_url: otpauthUrl,
      qr_data_url: qrDataUrl,
    })
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
