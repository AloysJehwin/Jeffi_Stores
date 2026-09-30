import { NextRequest, NextResponse } from 'next/server'
import { verifyOTP, deleteOTP } from '@/lib/auth/otp'
import { issuePortalToken, setPortalCookie } from '@/lib/auth/portal-session'

export const dynamic = 'force-dynamic'

const otpKey = (email: string) => `certportal:${email.toLowerCase()}`

export async function POST(request: NextRequest) {
  try {
    const { email, code } = await request.json().catch(() => ({}))
    if (!email || !code || typeof email !== 'string' || typeof code !== 'string') {
      return NextResponse.json({ error: 'Email and code are required' }, { status: 400 })
    }
    const key = otpKey(email)
    const result = await verifyOTP(key, code.trim())
    if (!result.valid) return NextResponse.json({ error: result.message || 'Invalid or expired code' }, { status: 401 })
    await deleteOTP(key)
    const token = await issuePortalToken(email, null)
    return setPortalCookie(NextResponse.json({ email: email.toLowerCase() }), token)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
