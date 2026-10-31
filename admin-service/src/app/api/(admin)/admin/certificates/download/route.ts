import { NextResponse } from 'next/server'
import { certPortalUrl } from '@/lib/tenancy/cert-delivery'

export const dynamic = 'force-dynamic'

// #487: admin certificates are NEVER downloadable from an admin/super-admin panel. The sole path is
// the certificate portal (certificate.<root>). This endpoint is a permanent tombstone — it returns
// 410 Gone unconditionally (no auth check, no token lookup, no .p12 ever served) so any cached link
// or stale UI gets a clear redirect to the portal.
export async function GET() {
  return NextResponse.json(
    {
      error: 'Admin certificates are no longer downloadable here.',
      message: `Download your certificate once from the certificate portal: ${certPortalUrl()}`,
      portalUrl: certPortalUrl(),
    },
    { status: 410 }
  )
}
