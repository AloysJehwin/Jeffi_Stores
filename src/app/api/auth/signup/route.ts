import { NextRequest, NextResponse } from 'next/server'
import { isOTPVerified, deleteOTP } from '@/lib/otp'
import { sendWelcomeEmail } from '@/lib/email'
import { supabaseAdmin } from '@/lib/supabase'
import { SignJWT } from 'jose'
import { cookies } from 'next/headers'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-change-in-production'
)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, otp, firstName, lastName, phone } = body

    console.log('Signup request:', { email, otp: otp ? '***' : undefined, firstName, lastName, phone })

    // Validate required fields
    if (!email || !otp || !firstName) {
      console.log('Validation failed:', { email: !!email, otp: !!otp, firstName: !!firstName })
      return NextResponse.json(
        { error: 'Email, OTP, and first name are required' },
        { status: 400 }
      )
    }

    // Check if OTP was verified (should have been verified in previous step)
    const otpValid = await isOTPVerified(email)
    if (!otpValid) {
      return NextResponse.json(
        { error: 'Please verify your OTP first' },
        { status: 400 }
      )
    }

    // Check if email already exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single()

    if (existingUser) {
      // Clean up OTP
      await deleteOTP(email)
      return NextResponse.json({ error: 'Email already registered' }, { status: 400 })
    }

    // Create user
    const { data: newUser, error: createError } = await supabaseAdmin
      .from('users')
      .insert({
        email: email.toLowerCase(),
        first_name: firstName,
        last_name: lastName || null,
        phone: phone || null,
        is_active: true,
        last_login: new Date().toISOString(),
      })
      .select()
      .single()

    if (createError || !newUser) {
      console.error('User creation error:', createError)
      return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
    }

    // Send welcome email (don't wait for it)
    sendWelcomeEmail(email, firstName).catch(err =>
      console.error('Welcome email failed:', err)
    )

    // Create JWT token
    const token = await new SignJWT({
      userId: newUser.id,
      email: newUser.email
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('30d')
      .sign(JWT_SECRET)

    // Set cookie
    const cookieStore = await cookies()
    cookieStore.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    })

    // Also set session_id to user's UUID for cart/wishlist
    cookieStore.set('session_id', newUser.id, {
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    })

    // Clean up OTP after successful signup
    await deleteOTP(email)

    return NextResponse.json({
      message: 'Account created successfully',
      user: {
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.first_name,
        lastName: newUser.last_name,
        phone: newUser.phone,
      },
    })
  } catch (error) {
    console.error('Signup error:', error)
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }
}
