import { NextRequest } from 'next/server'
import { ecomInsightsGet, poolInsightsSeries } from '@controller/lib/overviews/ecom-insights'

export const dynamic = 'force-dynamic'

// Provisioning jobs that finished each day (by their last update): done against failed. Same scope as the instances
// overview API.
export async function GET(request: NextRequest) {
  return ecomInsightsGet(request, 'ecom_instances:read', undefined, (pool, q) =>
    poolInsightsSeries(pool, {
      table: 'provisioning_jobs',
      alias: 'j',
      dateColumn: 'updated_at',
      where: `j.status IN ('done', 'failed')`,
      series: [
        { key: 'done', label: 'Provisioned', where: `j.status = 'done'` },
        { key: 'failed', label: 'Failed', where: `j.status = 'failed'` },
      ],
      weeks: q.weeks,
    })
  )
}
