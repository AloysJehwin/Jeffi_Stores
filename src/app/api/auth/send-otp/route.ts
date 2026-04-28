import { NextRequest, NextResponse } from 'next/server'
import { generateOTP, storeOTP } from '@/lib/otp'
import { sendOTPEmail } from '@/lib/email'
import { queryOne } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, isSignup } = body

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
    }

    if (isSignup) {
      const existingUser = await queryOne(
        'SELECT id FROM users WHERE email = $1',
        [email.toLowerCase()]
      )

      if (existingUser) {
        return NextResponse.json({ error: 'Email already registered' }, { status: 400 })
      }
    } else {
      const existingUser = await queryOne(
        'SELECT id, first_name FROM users WHERE email = $1',
        [email.toLowerCase()]
      )

      if (!existingUser) {
        return NextResponse.json({ error: 'No account found with this email. Please sign up first.', userNotFound: true }, { status: 404 })
      }
    }

    const otp = generateOTP()
    storeOTP(email, otp)

    const emailResult = await sendOTPEmail(email, otp)

    if (!emailResult.success) {
      return NextResponse.json(
        { error: 'Failed to send OTP email. Please try again.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: 'OTP sent successfully to your email',
      email: email.toLowerCase(),
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to send OTP' }, { status: 500 })
  }
}

