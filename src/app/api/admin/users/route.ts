import { NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { createAdminUser } from '@/lib/auth'
import { generateClientCertificate } from '@/lib/certificates'
import { sendAdminCertificateEmail } from '@/lib/email'
import { query } from '@/lib/db'
import { NextRequest } from 'next/server'
import { assignableScopeKeys, isPlatformOwner } from '@/lib/scopes'
import { resolveRequestTenantId } from '@/lib/request-tenant'

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin || !isPlatformOwner(admin.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await request.json()
    const { email, first_name, last_name, role, scopes } = body

    if (!email || !first_name || !last_name) {
      return NextResponse.json(
        { error: 'Missing required fields: email, first_name, last_name' },
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
      // Not ALL_SCOPE_KEYS: a tenant owner is super_admin, so validating against the platform's
      // full set let them grant control-plane scopes the UI does not offer.
      const allowed = await assignableScopeKeys(await resolveRequestTenantId())
      for (const scope of scopes) {
        if (!allowed.includes(scope)) {
          return NextResponse.json({ error: `Invalid scope: ${scope}` }, { status: 400 })
        }
      }
    }

    const result = await createAdminUser({
      email,
      first_name,
      last_name,
      role: role || 'admin',
      scopes: scopes || [],
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    // Certificate CN is the admin's email (sanitized for x509 CN if needed).
    const certCN = email.replace(/[^a-zA-Z0-9._@-]/g, '_')

    const cert = await generateClientCertificate(certCN, result.admin!.id)

    await query(
      `INSERT INTO admin_certificates (admin_id, serial_number, common_name, expires_at, download_token, p12_data, p12_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [result.admin!.id, cert.serialNumber, certCN, cert.expiresAt, cert.downloadToken, cert.p12Buffer, cert.p12Password]
    )

    const emailResult = await sendAdminCertificateEmail(
      email,
      `${first_name} ${last_name}`.trim() || email,
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
        email,
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
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
