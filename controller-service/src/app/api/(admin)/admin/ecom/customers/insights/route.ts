import { NextRequest } from 'next/server'
import { ecomInsightsGet, poolInsightsSeries } from '@controller/lib/overviews/ecom-insights'
import { NOT_PLATFORM } from '@controller/lib/overviews/ecom-platform'

export const dynamic = 'force-dynamic'

const PRODUCTS = ['all', 'store', 'services']
const WHERE: Record<string, string> = {
  all: NOT_PLATFORM,
  store: `${NOT_PLATFORM} AND 'store' = ANY(t.service_types)`,
  services: `${NOT_PLATFORM} AND EXISTS (SELECT 1 FROM unnest(t.service_types) x WHERE x <> 'store')`,
}

// Daily workspace signups, split into the ones that went live (active, or since suspended or terminated) and the rest,
// optionally for one product. Same scope as the customers overview API.
export async function GET(request: NextRequest) {
  return ecomInsightsGet(request, 'ecom_customers:read', PRODUCTS, (pool, q) =>
    poolInsightsSeries(pool, {
      table: 'tenants',
      alias: 't',
      dateColumn: 'created_at',
      where: WHERE[q.filter ?? 'all'],
      series: [
        { key: 'pending', label: 'Not live yet', where: `t.status NOT IN ('active', 'suspended', 'terminated')` },
        { key: 'live', label: 'Went live', where: `t.status IN ('active', 'suspended', 'terminated')` },
      ],
      weeks: q.weeks,
      filter: q.filter,
    })
  )
}
