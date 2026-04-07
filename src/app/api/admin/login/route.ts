import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyAdminCredentials } from '@/lib/auth'
import { generateToken } from '@/lib/jwt'

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json()

    // Validate input
    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      )
    }

    // Verify credentials
    const result = await verifyAdminCredentials(username, password)

    if (!result.success || !result.admin) {
      return NextResponse.json(
        { error: result.error || 'Invalid credentials' },
        { status: 401 }
      )
    }

    // Generate JWT token
    const token = await generateToken({
      adminId: result.admin.id,
      username: result.admin.username,
      role: result.admin.role,
      scopes: result.admin.scopes || [],
    })

    // Set secure HTTP-only cookie
    const cookieStore = cookies()
    cookieStore.set('admin_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60, // 8 hours
      path: '/',
    })

    return NextResponse.json({
      success: true,
      admin: {
        username: result.admin.username,
        role: result.admin.role,
      },
    })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
