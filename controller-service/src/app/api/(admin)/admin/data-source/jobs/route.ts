import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { listImportJobs, resolveImportTenantId } from '@/lib/import/jobs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Import history for the Data Source page. products:read gated; scoped to the ALS tenant (or the
// platform sentinel on flagship).
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'products:read')
  if (admin instanceof NextResponse) return admin

  const jobs = await listImportJobs(await resolveImportTenantId())
  return NextResponse.json({ jobs })
}
