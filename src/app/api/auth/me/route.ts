import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { jwtVerify } from 'jose'
import { queryOne } from '@/lib/db'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-change-in-production'
)

export async function GET(request: NextRequest) {
  try {
    const token = cookies().get('auth_token')?.value

    if (!token) {
      return NextResponse.json({ user: null })
    }

    // Verify JWT
    const { payload } = await jwtVerify(token, JWT_SECRET)

    // Get user from database
    const user = await queryOne(
      'SELECT id, email, first_name, last_name, phone, created_at FROM users WHERE id = $1',
      [payload.userId as string]
    )

    if (!user) {
      // Invalid token or user not found
      cookies().delete('auth_token')
      return NextResponse.json({ user: null })
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        createdAt: user.created_at,
      },
    })
  } catch (error) {
    console.error('Auth verification error:', error)
    cookies().delete('auth_token')
    return NextResponse.json({ user: null })
  }
}
