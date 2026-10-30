import { NextRequest } from 'next/server'
import { ecomOverviewGet } from '@controller/lib/overviews/ecom-route'
import { getEcomBillingOverview } from '@controller/lib/overviews/ecom-billing'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return ecomOverviewGet(request, 'ecom_billing:read', (pool, period) => getEcomBillingOverview(pool, period))
}
