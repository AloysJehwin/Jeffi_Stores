import { NextRequest } from 'next/server'
import { ecomInsightsGet, poolInsightsSeries } from '@controller/lib/overviews/ecom-insights'

export const dynamic = 'force-dynamic'

const KINDS = ['releases', 'provisioning']

// Store health events per day: schema release runs (succeeded against failed) or provisioning steps (ok against
// errors). Same scope as the store-status overview API.
export async function GET(request: NextRequest) {
  return ecomInsightsGet(request, 'ecom_customers:read', KINDS, (pool, q) =>
    q.filter === 'provisioning'
      ? poolInsightsSeries(pool, {
          table: 'provisioning_step_events',
          alias: 'e',
          dateColumn: 'created_at',
          where: `e.status IN ('ok', 'warning', 'error')`,
          series: [
            { key: 'ok', label: 'Completed', where: `e.status IN ('ok', 'warning')` },
            { key: 'error', label: 'Errors', where: `e.status = 'error'` },
          ],
          weeks: q.weeks,
          filter: q.filter,
        })
      : poolInsightsSeries(pool, {
          table: 'tenant_migration_runs',
          alias: 'm',
          dateColumn: 'ran_at',
          where: `m.status IN ('success', 'failed')`,
          series: [
            { key: 'success', label: 'Succeeded', where: `m.status = 'success'` },
            { key: 'failed', label: 'Failed', where: `m.status = 'failed'` },
          ],
          weeks: q.weeks,
          filter: q.filter,
        })
  )
}
