import { NextRequest, NextResponse } from 'next/server'
import { controlPlanePool } from '@/lib/tenant-registry'
import { verifyPortalToken, PORTAL_COOKIE } from '@/lib/auth/portal-session'
import { certNeedsMobileCheck, inCertStore } from '@/lib/auth/cert-mobile'
import { maskMobile } from '@/lib/auth/admin-mobile'

export const dynamic = 'force-dynamic'

// List the signed-in admin's certificates. Matches strictly on the verified Google email
// (lower(issued_to) = lower(email)); an account with no matching certs gets an empty list. No blob
// or password is returned here — only status, so the list is safe to render.
export async function GET(request: NextRequest) {
  const session = await verifyPortalToken(request.cookies.get(PORTAL_COOKIE)?.value).catch(() => null)
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { rows } = await controlPlanePool().query(
    `SELECT serial, tenant_id::text, common_name, role, store_name, expires_at, downloaded_at, revoked_at
       FROM portal_certs
      WHERE lower(issued_to) = lower($1)
      ORDER BY created_at DESC`,
    [session.email]
  )

  // A certificate that can still be downloaded first needs the admin's mobile number verified in its store.
  const mobiles = new Map<string, { needsMobile: boolean; mobileHint: string | null }>()
  if (certNeedsMobileCheck())
    for (const r of rows as any[]) {
      const key = r.tenant_id ?? 'platform'
      if (r.downloaded_at || r.revoked_at || mobiles.has(key)) continue
      const m = await inCertStore(r.tenant_id, r.store_name, session.email, async ({ admin }) => ({
        needsMobile: !admin?.mobile_verified_at,
        mobileHint: admin?.mobile_verified_at ? maskMobile(admin.mobile) : null,
      })).catch(() => null)
      mobiles.set(key, m ?? { needsMobile: true, mobileHint: null })
    }

  const now = Date.now()
  const certs = rows.map((r: any) => {
    const expired = new Date(r.expires_at).getTime() <= now
    const status = r.revoked_at ? 'revoked' : expired ? 'expired' : r.downloaded_at ? 'downloaded' : 'available'
    return {
      serial: r.serial,
      commonName: r.common_name,
      role: r.role,
      storeName: r.store_name,
      expiresAt: r.expires_at,
      downloadedAt: r.downloaded_at,
      status,
      needsMobile: status === 'available' && !!mobiles.get(r.tenant_id ?? 'platform')?.needsMobile,
      mobileHint: mobiles.get(r.tenant_id ?? 'platform')?.mobileHint ?? null,
    }
  })

  return NextResponse.json({ email: session.email, name: session.name, certs })
}
