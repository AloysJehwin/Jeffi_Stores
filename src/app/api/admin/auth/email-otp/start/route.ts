import { NextRequest, NextResponse } from 'next/server'
import { generateOTP, storeOTP, checkSendOtpRateLimit, recordSendOtp } from '@/lib/otp'
import { sendOTPEmail } from '@/lib/email'
import { resolveAdminByEmail, enforceCertGate } from '@/lib/admin-identity'

export const dynamic = 'force-dynamic'

const GENERIC = { message: 'If that email is registered, a verification code has been sent.' }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Layer 2 (identity) — send an email OTP to a registered admin. Returns a generic
// success for unknown/unauthorized emails so admin existence isn't leaked.
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json().catch(() => ({}))
    if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
    }

    const rate = await checkSendOtpRateLimit(email)
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Please wait before requesting another code.', retryAfter: rate.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } }
      )
    }

    // Resolve the admin FIRST — for unknown emails we return generic success
    // without touching the cert gate (so success/failure look identical).
    const admin = await resolveAdminByEmail(email)
    if (!admin) {
      return NextResponse.json(GENERIC)
    }

    // Cert gate (prod). A cert failure for a real admin is a genuine 403.
    const certCN = request.headers.get('x-client-cert-cn') || ''
    const certSerial = request.headers.get('x-client-cert-serial') || ''
    const gate = await enforceCertGate(admin, certCN, certSerial)
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status })
    }

    const otp = generateOTP()
    await storeOTP(email, otp)
    await sendOTPEmail(email, otp, admin.first_name || undefined)
    await recordSendOtp(email)

    return NextResponse.json({ ...GENERIC, nextCooldown: rate.nextCooldown })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
