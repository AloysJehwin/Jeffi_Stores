import { NextRequest, NextResponse } from 'next/server'
import { verifyOTP, deleteOTP, resetSendOtpCounter } from '@/lib/otp'
import { issueOwnerSession, setOwnerCookie } from '@/lib/owner-session'
import { extractSessionSignals } from '@/lib/session-signals-request'

// Ecom OWNER verify-otp → creates/finds the owner + issues an owner session.
// Same endpoint for signup + signin (findOrCreateOwner upserts). name optional (new signups).
export async function POST(request: NextRequest) {
  try {
    const { email, otp, name } = await request.json()
    if (!email || !otp) return NextResponse.json({ error: 'Email and OTP are required' }, { status: 400 })

    const result = await verifyOTP(email, otp)
    if (!result.valid) return NextResponse.json({ error: result.message }, { status: 400 })

    const signals = extractSessionSignals(request)
    const { sid, owner } = await issueOwnerSession({ email, name: name || null, signals })
    await deleteOTP(email)
    await resetSendOtpCounter(email)

    const res = NextResponse.json({
      message: 'Signed in',
      owner: { id: owner.id, email: owner.email, name: owner.name },
    })
    return setOwnerCookie(res, sid)
  } catch {
    return NextResponse.json({ error: 'Failed to verify OTP' }, { status: 500 })
  }
}
