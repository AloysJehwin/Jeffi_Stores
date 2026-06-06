import { NextRequest, NextResponse } from 'next/server'
import { verifyOTP, deleteOTP, resetSendOtpCounter } from '@/lib/otp'
import { queryOne, query } from '@/lib/db'
import { SignJWT } from 'jose'
import { cookies } from 'next/headers'
import { logActivity } from '@/lib/activity'

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is not set')
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET)

export async function POST(request: NextRequest) {
  try {
    const { email, otp } = await request.json()
    if (!email || !otp) return NextResponse.json({ error: 'Email and OTP are required' }, { status: 400 })

    const otpVerification = await verifyOTP(email, otp)
    if (!otpVerification.valid) {
      return NextResponse.json({ error: otpVerification.message }, { status: 400 })
    }

    const user = await queryOne<any>(
      `SELECT u.*, bp.approval_status, bp.company_name
       FROM users u
       LEFT JOIN business_profiles bp ON bp.user_id = u.id
       WHERE u.email = $1 AND u.user_type = 'business'`,
      [email.toLowerCase()]
    )

    if (!user) {
      return NextResponse.json({ error: 'No business account found. Please sign up.' }, { status: 404 })
    }

    if (!user.is_active) {
      return NextResponse.json({ error: 'Account is inactive' }, { status: 403 })
    }

    const approvalStatus = user.approval_status || 'pending'

    if (approvalStatus !== 'approved') {
      await deleteOTP(email)
      await resetSendOtpCounter(email)
      return NextResponse.json({ approvalStatus, message: approvalStatus === 'rejected' ? 'Your application was not approved.' : 'Your account is awaiting approval.' })
    }

    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id])
    logActivity({ userId: user.id, kind: 'login', summary: 'Business login via OTP', metadata: { provider: 'otp' } }).catch(() => {})

    const token = await new SignJWT({ userId: user.id, email: user.email, isBusiness: true, approvalStatus: 'approved' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('30d')
      .sign(JWT_SECRET)

    const cookieStore = await cookies()
    cookieStore.set('business_auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    })
    cookieStore.set('session_id', user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    })

    await deleteOTP(email)
    await resetSendOtpCounter(email)

    return NextResponse.json({
      message: 'Login successful',
      approvalStatus: 'approved',
      user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, companyName: user.company_name },
    })
  } catch {
    return NextResponse.json({ error: 'Login failed' }, { status: 500 })
  }
}
