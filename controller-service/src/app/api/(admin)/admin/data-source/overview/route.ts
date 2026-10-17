import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'
import { failStaleImportJobs, getGsheetStatus, getImportStats, resolveImportTenantId } from '@/lib/import/jobs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type CatalogCounts = {
  total: number
  active: number
  from_sheet: number
  from_import: number
  no_category: number
  no_brand: number
  no_price: number
}

// Overview numbers for the Data Source page: catalogue size and gaps the import template would
// catch, 30-day import results, the last upload and sheet sync, and jobs that need attention.
// Stuck jobs for this store are reset here as well as by the worker. products:read.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'products:read')
  if (admin instanceof NextResponse) return admin

  try {
    return NextResponse.json(await overview())
  } catch (e) {
    console.error('[data-source/overview] failed', { message: (e as Error)?.message })
    return NextResponse.json({ error: 'Could not load the overview. Try again.' }, { status: 500 })
  }
}

async function overview() {
  const tenantId = await resolveImportTenantId()
  const reset = await failStaleImportJobs(tenantId).catch(() => 0)

  const [stats, gsheet, catalog] = await Promise.all([
    getImportStats(tenantId, 30),
    getGsheetStatus(tenantId),
    queryOne<CatalogCounts>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE is_active)::int AS active,
              count(*) FILTER (WHERE data_source = 'google_sheet')::int AS from_sheet,
              count(*) FILTER (WHERE data_source = 'import')::int AS from_import,
              count(*) FILTER (WHERE is_active AND category_id IS NULL)::int AS no_category,
              count(*) FILTER (WHERE is_active AND brand_id IS NULL)::int AS no_brand,
              count(*) FILTER (WHERE is_active AND NOT coalesce(has_variants, false) AND coalesce(base_price, 0) <= 0)::int AS no_price
       FROM products`
    ).catch(e => {
      console.error('[data-source/overview] catalogue counts failed', { message: (e as Error)?.message })
      return null
    }),
  ])

  return { stats, gsheet, catalog, reset }
}
