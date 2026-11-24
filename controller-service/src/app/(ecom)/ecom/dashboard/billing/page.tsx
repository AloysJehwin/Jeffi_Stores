import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { listPlans, controlPlanePool, hasService } from '@/lib/tenant-registry'
import { billingOverview } from '@controller/lib/billing/overview'
import PageHeader from '../_components/PageHeader'
import BillingClient from './BillingClient'
import AdFreeCard from './AdFreeCard'
import MessagingAddonCard from './MessagingAddonCard'
import { messagingAddonState } from '@controller/lib/ecom/messaging-addon-state'
import { adFreeState } from '@controller/lib/ecom/ad-free-state'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Billing' }

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant: tenantSlug } = await searchParams
  const { tenant } = await loadOwnerContext({ tenantSlug })
  const isStore = hasService(tenant, 'store')
  // Ad-free and SMS & WhatsApp are store add-ons.
  const addons = isStore && tenant.status === 'active'
  const [plans, priceRow, overview, adFree, messaging] = await Promise.all([
    listPlans('any'),
    controlPlanePool()
      .query<{ price: string | null }>(`SELECT price_inr_month AS price FROM tenant_compute WHERE tenant_id = $1`, [tenant.id])
      .catch(() => ({ rows: [] as { price: string | null }[] })),
    billingOverview(tenant.id).catch(() => null),
    addons ? adFreeState(tenant.id).catch(() => null) : null,
    addons ? messagingAddonState(tenant.id).catch(() => null) : null,
  ])
  const priceInrMonth = priceRow.rows[0]?.price == null ? null : Number(priceRow.rows[0].price)

  return (
    <>
      <PageHeader eyebrow="Account" title="Billing" description="Your plan, renewal, add-ons and subscription controls." />
      <BillingClient tenant={tenant} plans={plans} overview={overview} isStore={isStore} priceInrMonth={priceInrMonth}>
        {adFree && <AdFreeCard initial={adFree} tenantSlug={tenant.slug} />}
        {messaging && <MessagingAddonCard initial={messaging} tenantSlug={tenant.slug} />}
      </BillingClient>
    </>
  )
}
