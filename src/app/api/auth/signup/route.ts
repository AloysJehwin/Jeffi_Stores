import { NextRequest, NextResponse } from 'next/server'
import { isOTPVerified, deleteOTP } from '@/lib/otp'
import { sendWelcomeEmail } from '@/lib/email'
import { queryOne } from '@/lib/db'
import { SignJWT } from 'jose'
import { cookies } from 'next/headers'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-change-in-production'
)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, firstName, lastName, phone } = body

    if (!email || !firstName) {
      return NextResponse.json(
        { error: 'Email and first name are required' },
        { status: 400 }
      )
    }

    const otpValid = await isOTPVerified(email)
    if (!otpValid) {
      return NextResponse.json(
        { error: 'Please verify your OTP first' },
        { status: 400 }
      )
    }

    let normalizedPhone = null
    if (phone) {
      const digits = phone.replace(/\D/g, '')
      const cleaned = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits
      if (cleaned.length !== 10) {
        return NextResponse.json({ error: 'Enter a valid 10-digit mobile number' }, { status: 400 })
      }
      normalizedPhone = `+91${cleaned}`
    }

    const existingUser = await queryOne(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    )

    if (existingUser) {
      await deleteOTP(email)
      return NextResponse.json({ error: 'Email already registered' }, { status: 400 })
    }

    const newUser = await queryOne(
      `INSERT INTO users (email, first_name, last_name, phone, is_active, last_login)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [email.toLowerCase(), firstName, lastName || null, normalizedPhone, true]
    )

    if (!newUser) {
      return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
    }

    sendWelcomeEmail(email, firstName).catch(() => {})

    const token = await new SignJWT({
      userId: newUser.id,
      email: newUser.email
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('30d')
      .sign(JWT_SECRET)

    const cookieStore = await cookies()
    cookieStore.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    })

    cookieStore.set('session_id', newUser.id, {
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    })

    await deleteOTP(email)

    return NextResponse.json({
      message: 'Account created successfully',
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.first_name,
        lastName: newUser.last_name,
        phone: newUser.phone,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }
}
