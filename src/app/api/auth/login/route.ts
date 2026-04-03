import { NextRequest, NextResponse } from 'next/server'
import { verifyOTP, deleteOTP } from '@/lib/otp'
import { supabaseAdmin } from '@/lib/supabase'
import { SignJWT } from 'jose'
import { cookies } from 'next/headers'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-change-in-production'
)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, otp } = body

    // Validate required fields
    if (!email || !otp) {
      return NextResponse.json({ error: 'Email and OTP are required' }, { status: 400 })
    }

    // Verify OTP
    const otpVerification = await verifyOTP(email, otp)
    if (!otpVerification.valid) {
      return NextResponse.json({ error: otpVerification.message }, { status: 400 })
    }

    // Get user
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single()

    if (userError || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (!user.is_active) {
      return NextResponse.json({ error: 'Account is inactive' }, { status: 403 })
    }

    // Update last login
    await supabaseAdmin
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id)

    // Migrate guest cart to user account
    const cookieStore = await cookies()
    const guestSessionId = cookieStore.get('session_id')?.value
    if (guestSessionId && guestSessionId.startsWith('guest_')) {
      // Transfer guest cart items to user
      await supabaseAdmin
        .from('cart_items')
        .update({ user_id: user.id })
        .eq('user_id', guestSessionId)

      // Transfer guest wishlist items to user
      await supabaseAdmin
        .from('wishlist_items')
        .update({ user_id: user.id })
        .eq('user_id', guestSessionId)
    }

    // Create JWT token
    const token = await new SignJWT({
      userId: user.id,
      email: user.email,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('30d')
      .sign(JWT_SECRET)

    // Set cookies
    cookieStore.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    })

    // Update session_id to user's UUID
    cookieStore.set('session_id', user.id, {
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    })

    // Clean up OTP after successful login
    await deleteOTP(email)

    return NextResponse.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
      },
    })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json({ error: 'Login failed' }, { status: 500 })
  }
}
