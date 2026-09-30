import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { createAdminUser } from '@/lib/auth'
import { generateClientCertificate } from '@/lib/certificates'
import { issueTenantAdminCert } from '@/lib/tenant-ca'
import { sendAdminCertificateEmail } from '@/lib/email'
import { query } from '@/lib/db'
import { NextRequest } from 'next/server'
import { isPlatformOwner } from '@/lib/scopes'
import { assignableScopeKeys } from '@/lib/scopes-server'
import { resolveRequestTenantId } from '@/lib/request-tenant'
import { resolveTenant } from '@/lib/tenant-context'
import { recordPortalCert } from '@/lib/portal-certs'

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin || !isPlatformOwner(admin.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await request.json()
    const { email, first_name, last_name, role, scopes } = body

    if (!email || !first_name || !last_name) {
      return NextResponse.json({ error: 'Missing required fields: email, first_name, last_name' }, { status: 400 })
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

    // Issue from the RIGHT CA: on a tenant admin host nginx validates client certs against that
    // tenant's OWN CA, so a platform-CA cert would never authenticate (this was the "team member
    // section not working for tenants" bug). Platform host → platform CA. Normalise both issuers
    // into one shape; the tenant issuer has no downloadToken, so generate one.
    const tenant = await resolveTenant().catch(() => null)
    let cert: { serialNumber: string; expiresAt: Date; downloadToken: string; p12Buffer: Buffer; p12Password: string }
    if (tenant?.tenantId) {
      const c = await issueTenantAdminCert({
        tenantId: tenant.tenantId,
        slug: tenant.slug,
        commonName: certCN,
        issuedTo: email,
      })
      cert = {
        serialNumber: c.serial,
        expiresAt: c.expiresAt,
        downloadToken: crypto.randomUUID(),
        p12Buffer: c.p12Buffer,
        p12Password: c.p12Password,
      }
    } else {
      cert = await generateClientCertificate(certCN, result.admin!.id)
    }

    await query(
      `INSERT INTO admin_certificates (admin_id, serial_number, common_name, expires_at, download_token, p12_data, p12_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        result.admin!.id,
        cert.serialNumber,
        certCN,
        cert.expiresAt,
        cert.downloadToken,
        cert.p12Buffer,
        cert.p12Password,
      ]
    )

    // Also record in the central portal registry so certificate.jeffistores.in can serve it.
    // Non-fatal: the cert is still emailed during the transition window.
    await recordPortalCert({
      tenantId: tenant?.tenantId ?? null,
      serial: cert.serialNumber,
      commonName: certCN,
      issuedTo: email,
      role: role || 'admin',
      storeName: tenant?.displayName ?? 'Jeffi Stores',
      p12Buffer: cert.p12Buffer,
      p12Password: cert.p12Password,
      expiresAt: cert.expiresAt,
      downloadToken: cert.downloadToken,
    })

    const emailResult = await sendAdminCertificateEmail(
      email,
      `${first_name} ${last_name}`.trim() || email,
      cert.p12Buffer,
      cert.p12Password,
      cert.serialNumber,
      cert.expiresAt.toISOString(),
      role || 'admin'
    )

    // Hard-cutover mode: never hand the p12/password back to the browser; the new admin fetches it
    // from certificate.jeffistores.in. In 'email'/'both' the blob still flows for the on-screen
    // download during the transition window.
    const { mayDeliverBlob, certPortalUrl } = await import('@/lib/cert-delivery')
    return NextResponse.json({
      success: true,
      emailSent: emailResult.success,
      admin: {
        id: result.admin!.id,
        email,
        role: role || 'admin',
        scopes: scopes || [],
      },
      portalInvite: !mayDeliverBlob(),
      portalUrl: certPortalUrl(),
      certificate: mayDeliverBlob()
        ? {
            p12Base64: cert.p12Buffer.toString('base64'),
            p12Password: cert.p12Password,
            serialNumber: cert.serialNumber,
            expiresAt: cert.expiresAt.toISOString(),
            downloadToken: cert.downloadToken,
          }
        : {
            serialNumber: cert.serialNumber,
            expiresAt: cert.expiresAt.toISOString(),
          },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
