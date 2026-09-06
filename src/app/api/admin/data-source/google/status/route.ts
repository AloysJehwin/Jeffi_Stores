import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/jwt'
import { resolveImportTenantId, getGsheetStatus } from '@/lib/import/jobs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Report the Data Source Google-sheet sync state for this tenant: whether it's connected, the
// configured spreadsheet id (non-secret, from meta — never the refresh token), and a summary of the
// last sheet sync (status + counts) so the tab can show the current effort/outcome. products:read.
// On the flagship admin (no ALS tenant) everything is keyed to the platform sentinel.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'products:read')
  if (admin instanceof NextResponse) return admin

  return NextResponse.json(await getGsheetStatus(resolveImportTenantId()))
}
