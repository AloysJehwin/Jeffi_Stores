import { NextRequest, NextResponse } from 'next/server'
import { isOTPVerified, deleteOTP, resetSendOtpCounter } from '@/lib/otp'
import { queryOne, query } from '@/lib/db'
import { SignJWT } from 'jose'
import { cookies } from 'next/headers'
import { logActivity } from '@/lib/activity'

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is not set')
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, firstName, lastName, phone, companyName, gstNumber, businessAddress, industry } = body

    if (!email || !firstName || !phone || !companyName || !gstNumber || !businessAddress || !industry) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    }

    const otpValid = await isOTPVerified(email)
    if (!otpValid) {
      return NextResponse.json({ error: 'Please verify your OTP first' }, { status: 400 })
    }

    const digits = phone.replace(/\D/g, '')
    const cleaned = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits
    if (cleaned.length !== 10) {
      return NextResponse.json({ error: 'Enter a valid 10-digit mobile number' }, { status: 400 })
    }

    const existingUser = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE email = $1 AND user_type = 'business'",
      [email.toLowerCase()]
    )
    if (existingUser) {
      await deleteOTP(email)
      return NextResponse.json({ error: 'A business account with this email already exists' }, { status: 400 })
    }

    const newUser = await queryOne<any>(
      `INSERT INTO users (email, first_name, last_name, phone, is_active, user_type, last_login)
       VALUES ($1, $2, $3, $4, true, 'business', NOW())
       RETURNING *`,
      [email.toLowerCase(), firstName, lastName || null, cleaned]
    )
    if (!newUser) return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })

    await query(
      `INSERT INTO business_profiles (user_id, company_name, gst_number, business_address, industry)
       VALUES ($1, $2, $3, $4, $5)`,
      [newUser.id, companyName.trim(), gstNumber.trim().toUpperCase(), businessAddress.trim(), industry.trim()]
    )

    logActivity({
      userId: newUser.id,
      kind: 'signup',
      summary: 'Business account created',
      metadata: { email, source: 'business_otp', companyName },
    }).catch(() => {})

    const token = await new SignJWT({ userId: newUser.id, email: newUser.email, isBusiness: true, approvalStatus: 'pending' })
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
    cookieStore.set('session_id', newUser.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    })

    await deleteOTP(email)
    await resetSendOtpCounter(email)

    return NextResponse.json({
      message: 'Business account created successfully',
      approvalStatus: 'pending',
      user: { id: newUser.id, email: newUser.email, firstName: newUser.first_name },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }
}
