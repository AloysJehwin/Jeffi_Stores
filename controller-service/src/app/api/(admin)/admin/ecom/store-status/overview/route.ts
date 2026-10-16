import { NextRequest } from 'next/server'
import { ecomOverviewGet } from '@/lib/overviews/ecom-route'
import { getEcomStoreStatusOverview } from '@/lib/overviews/ecom-store-status'
import { ROOT_DOMAIN } from '@/lib/tenant-registry/shared'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ?probe=1 also hits each live store's /api/ready (on demand, not on every load).
export async function GET(request: NextRequest) {
  return ecomOverviewGet(request, 'ecom_customers:read', (pool, period, sp) =>
    getEcomStoreStatusOverview(pool, period, { probe: sp.get('probe') === '1', rootDomain: ROOT_DOMAIN })
  )
}
