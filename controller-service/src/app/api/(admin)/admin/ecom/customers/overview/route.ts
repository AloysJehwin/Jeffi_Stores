import { NextRequest } from 'next/server'
import { ecomOverviewGet } from '@/lib/overviews/ecom-route'
import { getEcomCustomersOverview } from '@/lib/overviews/ecom-customers'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return ecomOverviewGet(request, 'ecom_customers:read', (pool, period) => getEcomCustomersOverview(pool, period))
}
