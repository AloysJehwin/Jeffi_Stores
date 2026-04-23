import { NextResponse } from 'next/server'
import { verifyAdminCredentials } from '@/lib/auth'
import { generateToken } from '@/lib/jwt'
import { queryOne } from '@/lib/db'

function serialToHex(serial: string): string {
  if (!serial) return ''
  if (/^[0-9a-fA-F]+$/.test(serial) && !/^\d+$/.test(serial)) return serial.toLowerCase()
  try {
    let n = BigInt(serial)
    let hex = ''
    while (n > 0n) {
      hex = (n % 16n).toString(16) + hex
      n = n / 16n
    }
    return hex || '0'
  } catch {
    return serial.toLowerCase()
  }
}

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
      const serialHex = serialToHex(certSerial)

      const cert = await queryOne(
        `SELECT * FROM admin_certificates
         WHERE LOWER(serial_number) = $1 AND admin_id = $2 AND is_revoked = FALSE AND expires_at > NOW()`,
        [serialHex, result.admin.id]
      )

      if (!cert) {
        const anyCert = await queryOne(
          `SELECT * FROM admin_certificates WHERE LOWER(serial_number) = $1`,
          [serialHex]
        )

        if (anyCert) {
          return NextResponse.json(
            { error: 'Certificate not authorized for this account' },
            { status: 403 }
          )
        }
      }
    } else if (certCN && certCN !== 'Admin User') {
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

    const response = NextResponse.json({
      success: true,
      token,
      admin: {
        username: result.admin.username,
        role: result.admin.role,
      },
    })

    response.cookies.set('admin_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60,
      path: '/',
    })

    return response
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
