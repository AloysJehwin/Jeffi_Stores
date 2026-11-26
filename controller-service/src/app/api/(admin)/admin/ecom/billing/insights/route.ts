import { NextRequest } from 'next/server'
import { ecomInsightsGet, poolInsightsSeries } from '@controller/lib/overviews/ecom-insights'

export const dynamic = 'force-dynamic'

// Subscription charges per day, split into the ones kept in full and the ones with money refunded (part or all), so
// the days stack to the charges. Same scope as the billing overview API.
export async function GET(request: NextRequest) {
  return ecomInsightsGet(request, 'ecom_billing:read', undefined, (pool, q) =>
    poolInsightsSeries(pool, {
      table: 'billing_charges',
      alias: 'c',
      dateColumn: 'charged_at',
      where: 'c.amount_paise > 0',
      series: [
        { key: 'kept', label: 'Kept', where: 'c.refunded_paise = 0' },
        { key: 'refunded', label: 'Refunded', where: 'c.refunded_paise > 0' },
      ],
      weeks: q.weeks,
    })
  )
}
