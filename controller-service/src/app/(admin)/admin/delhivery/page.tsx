import { PageBody, PageHeader } from '@/components/admin/kit'
import { getSiteControls } from '@/lib/catalog/site-controls'
import { ap } from '@/lib/shared/admin-path'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { getTenant } from '@/lib/tenant-registry'
import { Suspense } from 'react'
import DelhiveryPageClient, { type DeliveryMode } from './DelhiveryPageClient'
import DelhiveryTabs from './_components/DelhiveryTabs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// The flagship store runs with no tenant context and ships on the platform's own Delhivery key.
// A provisioned tenant's mode comes from the control-plane row.
async function resolveDeliveryMode(): Promise<DeliveryMode> {
  const tenantId = await resolveTenantId()
  if (!tenantId) return 'flagship'
  const tenant = await getTenant(tenantId).catch(() => null)
  return tenant?.own_delhivery ? 'own' : 'platform'
}

export default async function DelhiveryPage() {
  const [c, deliveryMode] = await Promise.all([getSiteControls(), resolveDeliveryMode()])

  return (
    <PageBody>
      <PageHeader back={{ href: ap('/admin/orders'), label: 'Orders' }} title="Delhivery" description="Shipments, deliveries, pickups and COD remittance" />

      <Suspense fallback={null}>
        <DelhiveryTabs
          pickups={
            <DelhiveryPageClient
              deliveryMode={deliveryMode}
              defaultWarehouse={{
                pickupLocation: c.values.pickupLocation,
                sellerName: c.values.sellerName,
                sellerAddress: c.values.sellerAddress,
                sellerPhone: c.values.sellerPhone,
                originPincode: c.values.delhiveryOriginPincode,
              }}
            />
          }
        />
      </Suspense>
    </PageBody>
  )
}
