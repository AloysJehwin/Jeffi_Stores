import { NextRequest, NextResponse } from 'next/server'
import { backfillProductEmbeddings } from '@/lib/shared/embed-products'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

export const dynamic = 'force-dynamic'

// Runs per tenant via the cron fan-out (tenantScope ai:storefront). The Host the fan-out sets resolves
// the tenant, so backfillProductEmbeddings embeds that tenant's own catalog into its own DB.
export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await backfillProductEmbeddings({ onlyMissing: true })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Embed sync failed' },
      { status: 500 }
    )
  }
}
