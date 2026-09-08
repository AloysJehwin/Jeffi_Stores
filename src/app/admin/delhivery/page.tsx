import Link from 'next/link'
import { getSiteControls } from '@/lib/site-controls'
import { getDeliverySettings } from '@/lib/delivery-settings'
import { SectionCard, NumberControl } from '@/components/admin/site-controls/controls'
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
  const [c, delivery, ownDelhivery] = await Promise.all([
    getSiteControls(),
    getDeliverySettings(),
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

      <SectionCard
        title="Shipping cost"
        description="Default weight and weight-based buyer shipping cost. The ship-from pincode is taken from each pickup address in the warehouse list above."
        columns
      >
        <NumberControl settingKey="default_product_weight_g" label="Default product weight" hint="Assumed weight for products with no weight set." suffix="g" min={1} initial={c.values.defaultProductWeightG} />
        <NumberControl settingKey="delivery_base_charge" label="Base shipping charge (≤3kg)" hint="Flat buyer charge for shipments up to the free-weight ceiling." prefix="₹" initial={delivery.baseCharge} />
        <NumberControl settingKey="delivery_per_kg_over_3" label="Per-kg surcharge over 3kg" hint="Added per whole kg above the free-weight ceiling." prefix="₹" initial={delivery.perKgOver3} />
        <NumberControl settingKey="delivery_free_weight_ceiling_kg" label="Free-weight ceiling" hint="Weight below which the free-shipping threshold applies." suffix="kg" min={0} step={0.5} initial={delivery.freeWeightCeilingKg} />
      </SectionCard>
    </div>
  )
}
