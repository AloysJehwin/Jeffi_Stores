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

      const cert = await queryOne<{ admin_id: string }>(
        `SELECT ac.admin_id FROM admin_certificates ac
         JOIN admin_users au ON au.id = ac.admin_id
         WHERE LOWER(ac.serial_number) = $1 AND ac.is_revoked = FALSE AND ac.expires_at > NOW()`,
        [serialHex]
      )

      if (cert) {
        const certOwner = await queryOne<{ role: string }>(
          `SELECT role FROM admin_users WHERE id = $1`,
          [cert.admin_id]
        )
        const certBelongsToThisAccount = cert.admin_id === result.admin.id
        const certOwnerIsSuperAdmin = certOwner?.role === 'super_admin'
        const loggingIntoSuperAdmin = result.admin.role === 'super_admin'

        if (loggingIntoSuperAdmin && !certOwnerIsSuperAdmin) {
          return NextResponse.json(
            { error: 'Certificate not authorized for this account' },
            { status: 403 }
          )
        }
        if (!certBelongsToThisAccount && !certOwnerIsSuperAdmin) {
          return NextResponse.json(
            { error: 'Certificate not authorized for this account' },
            { status: 403 }
          )
        }
      }
    } else if (certCN && certCN !== 'Admin User') {
      const certOwnerAccount = await queryOne<{ id: string; role: string }>(
        `SELECT id, role FROM admin_users WHERE username = $1`,
        [certCN]
      )
      const certBelongsToThisAccount = certOwnerAccount?.id === result.admin.id
      const certOwnerIsSuperAdmin = certOwnerAccount?.role === 'super_admin'
      const loggingIntoSuperAdmin = result.admin.role === 'super_admin'

      if (loggingIntoSuperAdmin && !certOwnerIsSuperAdmin) {
        return NextResponse.json(
          { error: 'Certificate not authorized for this account' },
          { status: 403 }
        )
      }
      if (!certBelongsToThisAccount && !certOwnerIsSuperAdmin) {
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
      authCertCN: certCN || undefined,
    })

    const response = NextResponse.json({
      success: true,
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
