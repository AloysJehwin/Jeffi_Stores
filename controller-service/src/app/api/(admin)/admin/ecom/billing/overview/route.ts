import { NextRequest } from 'next/server'
import { ecomOverviewGet } from '@controller/lib/overviews/ecom-route'
import { getEcomBillingOverview } from '@controller/lib/overviews/ecom-billing'
import { DEFAULT_SETTINGS, getCatalog } from '@controller/lib/compute/catalog'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return ecomOverviewGet(request, 'ecom_billing:read', async (pool, period) => {
    const margin = await getCatalog().then(c => c.settings.margin, () => DEFAULT_SETTINGS.margin)
    return getEcomBillingOverview(pool, period, margin)
  })
}
