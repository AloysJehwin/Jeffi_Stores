import { NextRequest, NextResponse } from 'next/server'
import { runTenantSchemaReport } from '@controller/lib/tenant-migrations'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Read-only: each active store database's distance from the tenant schema set (tables it carries beyond the set,
// with row counts, and tenant tables it lacks). deploy/k8s/db/40-tenant-fanout.sh <sha|live> --report calls it.
// Body { slug? } limits it to one store. 500 when a store could not be read. Auth: Bearer ${CRON_SECRET}.
export async function POST(request: NextRequest) {
  if (!verifyCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({}) as { slug?: string })
  const result = await runTenantSchemaReport({ slug: body.slug || undefined })
  return NextResponse.json({ ok: result.failed === 0, result }, { status: result.failed === 0 ? 200 : 500 })
}
