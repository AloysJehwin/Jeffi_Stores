import { NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { createAdminUser } from '@/lib/auth'
import { generateClientCertificate } from '@/lib/certificates'
import { sendAdminCertificateEmail } from '@/lib/email'
import { query } from '@/lib/db'
import { NextRequest } from 'next/server'
import { ALL_SCOPE_KEYS } from '@/lib/scopes'

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin || admin.role !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await request.json()
    const { username, password, email, first_name, last_name, role, scopes } = body

    if (!username || !password || !email || !first_name || !last_name) {
      return NextResponse.json(
        { error: 'Missing required fields: username, password, email, first_name, last_name' },
        { status: 400 }
      )
    }

    const validRoles = ['admin', 'moderator']
    if (role && !validRoles.includes(role)) {
      return NextResponse.json({ error: 'Invalid role. Must be admin or moderator.' }, { status: 400 })
    }

    if (scopes && !Array.isArray(scopes)) {
      return NextResponse.json({ error: 'Scopes must be an array' }, { status: 400 })
    }
    if (scopes) {
      for (const scope of scopes) {
        if (!ALL_SCOPE_KEYS.includes(scope)) {
          return NextResponse.json({ error: `Invalid scope: ${scope}` }, { status: 400 })
        }
      }
    }

    const result = await createAdminUser({
      username,
      password,
      email,
      first_name,
      last_name,
      role: role || 'admin',
      scopes: scopes || [],
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    const cert = await generateClientCertificate(username, result.admin!.id)

    await query(
      `INSERT INTO admin_certificates (admin_id, serial_number, common_name, expires_at, download_token, p12_data, p12_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [result.admin!.id, cert.serialNumber, username, cert.expiresAt, cert.downloadToken, cert.p12Buffer, cert.p12Password]
    )

    const emailResult = await sendAdminCertificateEmail(
      email,
      username,
      cert.p12Buffer,
      cert.p12Password,
      cert.serialNumber,
      cert.expiresAt.toISOString(),
      role || 'admin'
    )

    return NextResponse.json({
      success: true,
      emailSent: emailResult.success,
      admin: {
        id: result.admin!.id,
        username,
        role: role || 'admin',
        scopes: scopes || [],
      },
      certificate: {
        p12Base64: cert.p12Buffer.toString('base64'),
        p12Password: cert.p12Password,
        serialNumber: cert.serialNumber,
        expiresAt: cert.expiresAt.toISOString(),
        downloadToken: cert.downloadToken,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
