import Link from 'next/link'
import { getSiteControls } from '@/lib/site-controls'
import { ap } from '@/lib/admin-path'
import { resolveTenantId } from '@/lib/tenant-context'
import { getTenant } from '@/lib/tenant-registry'
import DelhiveryPageClient from './DelhiveryPageClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// The flagship store runs with no tenant context and ships on the platform's own Delhivery account,
// so it is always own_delhivery. A provisioned tenant's flag comes from the control-plane row.
async function resolveOwnDelhivery(): Promise<boolean> {
  const tenantId = await resolveTenantId()
  if (!tenantId) return true
  const tenant = await getTenant(tenantId).catch(() => null)
  return tenant?.own_delhivery ?? false
}

export default async function DelhiveryPage() {
  const [c, ownDelhivery] = await Promise.all([
    getSiteControls(),
    resolveOwnDelhivery(),
  ])

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <Link href={ap('/admin/orders')} className="text-accent-500 hover:text-accent-600 text-sm mb-2 inline-block">
          ← Back to Orders
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Delhivery Pickup Request</h1>
        <p className="text-foreground-secondary mt-1">
          Orders with an AWB not yet included in a pickup request. Pickup slot: 14:00–18:00.
        </p>
      </div>

      <DelhiveryPageClient
        ownDelhivery={ownDelhivery}
        defaultWarehouse={{
          pickupLocation: c.values.pickupLocation,
          sellerName: c.values.sellerName,
          sellerAddress: c.values.sellerAddress,
          sellerPhone: c.values.sellerPhone,
          originPincode: c.values.delhiveryOriginPincode,
        }}
      />
    </div>
  )
}
