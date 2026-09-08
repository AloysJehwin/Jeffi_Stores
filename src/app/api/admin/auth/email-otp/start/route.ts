import { NextRequest, NextResponse } from 'next/server'
import { generateOTP, storeOTP, checkSendOtpRateLimit, recordSendOtp } from '@/lib/otp'
import { sendAdminOTPEmail } from '@/lib/email'
import { resolveAdminByEmail, enforceCertGate } from '@/lib/admin-identity'

export const dynamic = 'force-dynamic'

const SENT = { message: 'A verification code has been sent to your email.' }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Layer 2 (identity) — send an email OTP to a registered admin. By product choice this
// endpoint blocks on the email step for non-admins (returns 404) rather than masking
// existence: the panel is gated by mTLS, so account-enumeration risk is acceptable and a
// clear "no admin account" message is preferred over silently advancing to the OTP step.
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

    // Validate the admin/moderator exists BEFORE sending anything. Unknown emails are
    // rejected here so the client stays on the email step instead of the OTP step.
    const admin = await resolveAdminByEmail(email)
    if (!admin) {
      return NextResponse.json({ error: 'No admin account found for this email.' }, { status: 404 })
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
    await sendAdminOTPEmail(email, otp, admin.first_name || undefined)
    await recordSendOtp(email)

    return NextResponse.json({ ...SENT, nextCooldown: rate.nextCooldown })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
