import { NextResponse } from 'next/server'
import { verifyAdminCredentials } from '@/lib/auth'
import { queryOne } from '@/lib/db'
import { issueMfaTicket } from '@/lib/mfa'
import { issueAdminSession } from '@/lib/admin-session'

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

    const isProduction = process.env.NODE_ENV === 'production'
    const certPresent = !!certSerial || (!!certCN && certCN !== 'Admin User')
    if (isProduction && !certPresent) {
      return NextResponse.json(
        { error: 'A client certificate is required to sign in. Please install your admin certificate and try again.' },
        { status: 403 }
      )
    }

    if (!isProduction) {
      const adminRow = await queryOne<{
        id: string; username: string; first_name: string | null; last_name: string | null; role: string; scopes: string[] | null
      }>(
        `SELECT a.id, a.username, u.first_name, u.last_name, a.role, a.scopes
           FROM admins a LEFT JOIN users u ON u.id = a.user_id
           WHERE a.id = $1 AND a.is_active = true`,
        [result.admin.id]
      )
      if (!adminRow) return NextResponse.json({ error: 'Admin not found' }, { status: 401 })
      return await issueAdminSession(adminRow, undefined)
    }

    if (certSerial) {
      const serialHex = serialToHex(certSerial)

      const cert = await queryOne<{ admin_id: string }>(
        `SELECT ac.admin_id FROM admin_certificates ac
         JOIN admins au ON au.id = ac.admin_id
         WHERE LOWER(ac.serial_number) = $1 AND ac.is_revoked = FALSE AND ac.expires_at > NOW()`,
        [serialHex]
      )

      if (!cert) {
        if (isProduction) {
          return NextResponse.json(
            { error: 'Certificate not recognized or expired. Please contact your administrator.' },
            { status: 403 }
          )
        }
      } else {
        const certOwner = await queryOne<{ role: string }>(
          `SELECT role FROM admins WHERE id = $1`,
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
        `SELECT id, role FROM admins WHERE username = $1`,
        [certCN]
      )
      if (!certOwnerAccount && isProduction) {
        return NextResponse.json(
          { error: 'Certificate not recognized. Please contact your administrator.' },
          { status: 403 }
        )
      }
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

    const mfaRow = await queryOne<{ mfa_enabled: boolean }>(
      `SELECT mfa_enabled FROM admins WHERE id = $1`,
      [result.admin.id]
    )

    if (mfaRow?.mfa_enabled) {
      const ticket = await issueMfaTicket({
        adminId: result.admin.id,
        username: result.admin.username,
        purpose: 'verify',
        certCN: certCN || undefined,
      })
      return NextResponse.json({ mfa_required: true, ticket })
    }

    const ticket = await issueMfaTicket({
      adminId: result.admin.id,
      username: result.admin.username,
      purpose: 'enroll',
      certCN: certCN || undefined,
    })
    return NextResponse.json({ enroll_required: true, ticket })
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
