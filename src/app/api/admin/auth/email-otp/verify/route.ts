import { NextRequest, NextResponse } from 'next/server'
import { verifyOTP, deleteOTP } from '@/lib/otp'
import { issueMfaTicket } from '@/lib/mfa'
import { resolveAdminByEmail, enforceCertGate } from '@/lib/admin-identity'
import { logActivity } from '@/lib/activity'

export const dynamic = 'force-dynamic'

// Layer 2 (identity) — verify the email OTP and, on success, issue the 5-min MFA
// ticket that the (unchanged) TOTP step consumes. Never mints admin_sid here.
export async function POST(request: NextRequest) {
  try {
    const { email, code } = await request.json().catch(() => ({}))
    if (!email || typeof email !== 'string' || !code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Email and code are required' }, { status: 400 })
    }

    const isProduction = process.env.NODE_ENV === 'production'
    // Dev convenience: accept a fixed OTP locally so login works without SMTP/Redis.
    const devOtp = process.env.ADMIN_DEV_OTP || '000000'
    const devBypass = !isProduction && code === devOtp

    if (!devBypass) {
      const result = await verifyOTP(email, code)
      if (!result.valid) {
        return NextResponse.json({ error: result.message || 'Invalid or expired code' }, { status: 401 })
      }
    }

    const admin = await resolveAdminByEmail(email)
    if (!admin) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 })
    }

    const certCN = request.headers.get('x-client-cert-cn') || ''
    const certSerial = request.headers.get('x-client-cert-serial') || ''
    const gate = await enforceCertGate(admin, certCN, certSerial)
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status })
    }

    // Consume the OTP (anti-replay).
    if (!devBypass) await deleteOTP(email)

    const purpose = admin.mfa_enabled ? 'verify' : 'enroll'
    const ticket = await issueMfaTicket({
      adminId: admin.id,
      purpose,
      certCN: gate.certCN,
    })

    logActivity({
      userId: admin.user_id,
      kind: 'login',
      summary: 'Admin identity verified via email OTP',
      metadata: { provider: 'email_otp', step: purpose },
    }).catch(() => {})

    return purpose === 'verify'
      ? NextResponse.json({ mfa_required: true, ticket })
      : NextResponse.json({ enroll_required: true, ticket })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
