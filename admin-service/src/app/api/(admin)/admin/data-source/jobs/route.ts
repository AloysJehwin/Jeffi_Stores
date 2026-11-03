import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { pageImportJobs, resolveImportTenantId, type JobListFilter } from '@/lib/import/jobs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const FILTERS: JobListFilter[] = ['all', 'active', 'done', 'failed', 'with_errors']

// Import history for the Data Source page, newest first and paged (?limit&offset&status&source).
// Rows omit row_results; the detail route returns them. products:read gated; scoped to the ALS
// tenant (or the platform sentinel on flagship).
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'products:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const status = sp.get('status') as JobListFilter | null
  const source = sp.get('source')
  try {
    const { jobs, total } = await pageImportJobs(await resolveImportTenantId(), {
      limit: Number(sp.get('limit')) || 20,
      offset: Number(sp.get('offset')) || 0,
      status: status && FILTERS.includes(status) ? status : 'all',
      source: source === 'upload' || source === 'google_sheet' ? source : 'all',
    })
    return NextResponse.json({ jobs, total })
  } catch (e) {
    console.error('[data-source/jobs] failed', { message: (e as Error)?.message })
    return NextResponse.json({ error: 'Could not load the import history. Try again.' }, { status: 500 })
  }
}
