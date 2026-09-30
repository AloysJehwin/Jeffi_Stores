import { NextRequest, NextResponse } from 'next/server'
import { controlPlanePool } from '@/lib/tenant-registry'
import { verifyPortalToken, PORTAL_COOKIE } from '@/lib/portal-session'
import { decryptPortalSecret } from '@/lib/portal-certs'

export const dynamic = 'force-dynamic'

// One-time download of the signed-in admin's own certificate. The download is claimed by an ATOMIC
// conditional UPDATE (sets downloaded_at only where it is still NULL and the cert is not revoked/
// expired, scoped to the signed-in email) — so two concurrent clicks cannot both succeed, and a
// copied link for someone else's serial matches no row. The password is returned in a header, never
// in a file or a log.
export async function GET(request: NextRequest, { params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params
  const session = await verifyPortalToken(request.cookies.get(PORTAL_COOKIE)?.value).catch(() => null)
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const pool = controlPlanePool()

  // Claim the download atomically. Only succeeds for THIS email's cert that is still downloadable.
  const claim = await pool.query(
    `UPDATE portal_certs
        SET downloaded_at = now()
      WHERE serial = $1
        AND lower(issued_to) = lower($2)
        AND downloaded_at IS NULL
        AND revoked_at IS NULL
        AND expires_at > now()
      RETURNING p12_data_enc, p12_password_enc, common_name`,
    [serial, session.email]
  )

  if (!claim.rows[0]) {
    // Distinguish "already downloaded / revoked / expired" from "no such cert for you" for a clear
    // message, without leaking whether a serial exists for a different email.
    const existing = await pool.query(
      `SELECT downloaded_at, revoked_at, expires_at FROM portal_certs
        WHERE serial = $1 AND lower(issued_to) = lower($2)`,
      [serial, session.email]
    )
    const row = existing.rows[0]
    if (!row) return NextResponse.json({ error: 'Certificate not found for this account' }, { status: 404 })
    if (row.revoked_at) return NextResponse.json({ error: 'This certificate has been revoked' }, { status: 410 })
    if (new Date(row.expires_at).getTime() <= Date.now())
      return NextResponse.json({ error: 'This certificate has expired' }, { status: 410 })
    return NextResponse.json(
      { error: 'This certificate has already been downloaded. Ask an admin to re-issue it.' },
      { status: 410 }
    )
  }

  let p12: Buffer
  let password: string
  try {
    p12 = Buffer.from(decryptPortalSecret(claim.rows[0].p12_data_enc), 'base64')
    password = decryptPortalSecret(claim.rows[0].p12_password_enc)
  } catch {
    return NextResponse.json({ error: 'Certificate could not be decrypted. Contact support.' }, { status: 500 })
  }

  const cn = String(claim.rows[0].common_name || 'admin').replace(/[^a-zA-Z0-9._@-]/g, '_')
  return new NextResponse(new Uint8Array(p12), {
    headers: {
      'Content-Type': 'application/x-pkcs12',
      'Content-Disposition': `attachment; filename="${cn}.p12"`,
      // The import password. Read once by the portal UI and shown on screen; never logged or emailed.
      'X-Cert-Password': password,
      'Cache-Control': 'no-store',
    },
  })
}
