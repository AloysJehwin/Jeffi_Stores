import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/jwt'
import { getImportJob, resolveImportTenantId } from '@/lib/import/jobs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// One import job with its per-row results (for live progress + the drill-in view).
// products:read gated; getImportJob is tenant-scoped so a job can't be read cross-tenant.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminScope(request, 'products:read')
  if (admin instanceof NextResponse) return admin

  const { id } = await params
  const job = await getImportJob(id, await resolveImportTenantId())
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ job })
}
