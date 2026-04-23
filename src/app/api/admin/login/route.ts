import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyAdminCredentials } from '@/lib/auth'
import { generateToken } from '@/lib/jwt'
import { queryOne } from '@/lib/db'

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json()

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      )
    }

    const result = await verifyAdminCredentials(username, password)

    if (!result.success || !result.admin) {
      return NextResponse.json(
        { error: result.error || 'Invalid credentials' },
        { status: 401 }
      )
    }

    const certCN = request.headers.get('x-client-cert-cn') || ''
    const certSerial = request.headers.get('x-client-cert-serial') || ''

    if (certSerial) {
      const cert = await queryOne(
        `SELECT * FROM admin_certificates
         WHERE serial_number = $1 AND admin_id = $2 AND is_revoked = FALSE AND expires_at > NOW()`,
        [certSerial, result.admin.id]
      )

      if (!cert) {
        return NextResponse.json(
          { error: 'Certificate not authorized for this account' },
          { status: 403 }
        )
      }
    } else if (certCN) {
      if (certCN !== result.admin.username) {
        return NextResponse.json(
          { error: 'Certificate not authorized for this account' },
          { status: 403 }
        )
      }
    }

    const token = await generateToken({
      adminId: result.admin.id,
      username: result.admin.username,
      role: result.admin.role,
      scopes: result.admin.scopes || [],
    })

    const cookieStore = cookies()
    cookieStore.set('admin_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60,
      path: '/',
    })

    return NextResponse.json({
      success: true,
      admin: {
        username: result.admin.username,
        role: result.admin.role,
      },
    })
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
