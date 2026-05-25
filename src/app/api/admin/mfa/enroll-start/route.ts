import { NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import { generateTotpSecret, buildOtpauthUrl, verifyMfaTicket } from '@/lib/mfa'
import QRCode from 'qrcode'

export async function POST(request: Request) {
  try {
    const { ticket } = await request.json()
    if (!ticket) return NextResponse.json({ error: 'Missing ticket' }, { status: 400 })

    const t = await verifyMfaTicket(ticket, 'enroll')
    if (!t) return NextResponse.json({ error: 'Invalid or expired ticket' }, { status: 401 })

    const admin = await queryOne<{ id: string; username: string; mfa_enabled: boolean }>(
      `SELECT id, username, mfa_enabled FROM admins WHERE id = $1 AND is_active = true`,
      [t.adminId]
    )
    if (!admin) return NextResponse.json({ error: 'Admin not found' }, { status: 404 })
    if (admin.mfa_enabled) return NextResponse.json({ error: 'Already enrolled' }, { status: 400 })

    const secret = await generateTotpSecret()
    const otpauthUrl = await buildOtpauthUrl(admin.username, secret)
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 240 })

    return NextResponse.json({
      secret,
      otpauth_url: otpauthUrl,
      qr_data_url: qrDataUrl,
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
