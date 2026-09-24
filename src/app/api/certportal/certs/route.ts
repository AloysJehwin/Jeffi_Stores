import { NextRequest, NextResponse } from 'next/server'
import { controlPlanePool } from '@/lib/tenant-registry'
import { verifyPortalToken, PORTAL_COOKIE } from '@/lib/portal-session'

export const dynamic = 'force-dynamic'

// List the signed-in admin's certificates. Matches strictly on the verified Google email
// (lower(issued_to) = lower(email)); an account with no matching certs gets an empty list. No blob
// or password is returned here — only status, so the list is safe to render.
export async function GET(request: NextRequest) {
  const session = await verifyPortalToken(request.cookies.get(PORTAL_COOKIE)?.value).catch(() => null)
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { rows } = await controlPlanePool().query(
    `SELECT serial, common_name, role, store_name, expires_at, downloaded_at, revoked_at
       FROM portal_certs
      WHERE lower(issued_to) = lower($1)
      ORDER BY created_at DESC`,
    [session.email]
  )

  const now = Date.now()
  const certs = rows.map((r: any) => {
    const expired = new Date(r.expires_at).getTime() <= now
    const status = r.revoked_at ? 'revoked'
      : expired ? 'expired'
      : r.downloaded_at ? 'downloaded'
      : 'available'
    return {
      serial: r.serial,
      commonName: r.common_name,
      role: r.role,
      storeName: r.store_name,
      expiresAt: r.expires_at,
      downloadedAt: r.downloaded_at,
      status,
    }
  })

  return NextResponse.json({ email: session.email, name: session.name, certs })
}
