import { NextRequest } from 'next/server'
import { ecomOverviewGet } from '@controller/lib/overviews/ecom-route'
import { getEcomInstancesOverview } from '@controller/lib/overviews/ecom-instances'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return ecomOverviewGet(request, 'ecom_instances:read', (pool, period) => getEcomInstancesOverview(pool, period))
}
