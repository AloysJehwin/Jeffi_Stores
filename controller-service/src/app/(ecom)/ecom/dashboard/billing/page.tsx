import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { listPlans, controlPlanePool } from '@/lib/tenant-registry'
import { getSubscription } from '@controller/lib/payments/razorpay-subscriptions'
import PageHeader from '../_components/PageHeader'
import BillingClient from './BillingClient'
import AdFreeCard from './AdFreeCard'
import MessagingAddonCard from './MessagingAddonCard'
import { messagingAddonState } from '@controller/lib/ecom/messaging-addon-state'
import { AD_FREE_PRICE_INR, getAdFree } from '@/lib/billing/ad-free'
import { getWalletBalance } from '@/lib/payments/wallet'

export const dynamic = 'force-dynamic'

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant: tenantSlug } = await searchParams
  const { tenant } = await loadOwnerContext({ tenantSlug })
  const [plans, priceRow] = await Promise.all([
    listPlans('any'),
    controlPlanePool()
      .query<{ price: string | null }>(`SELECT price_inr_month AS price FROM tenant_compute WHERE tenant_id = $1`, [tenant.id])
      .catch(() => ({ rows: [] as { price: string | null }[] })),
  ])
  const priceInrMonth = priceRow.rows[0]?.price == null ? null : Number(priceRow.rows[0].price)

  let renewalDate: string | null = null
  if (tenant.razorpay_subscription_id && tenant.subscription_status === 'active') {
    const sub = await getSubscription(tenant.razorpay_subscription_id).catch(() => null)
    if (sub?.current_end) {
      renewalDate = new Date(sub.current_end * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    }
  }

  const adFree =
    tenant.status === 'active'
      ? await Promise.all([getAdFree(tenant.id), getWalletBalance(tenant.id)])
          .then(([status, wallet]) => ({ ...status, priceInr: AD_FREE_PRICE_INR, balanceInr: wallet.balance }))
          .catch(() => null)
      : null
  const messaging = tenant.status === 'active' ? await messagingAddonState(tenant.id).catch(() => null) : null

  return (
    <>
      <PageHeader eyebrow="Account" title="Billing" description="Your plan, renewal, add-ons and subscription controls." />
      <div className="space-y-8">
        {adFree && <AdFreeCard initial={adFree} tenantSlug={tenant.slug} />}
        {messaging && <MessagingAddonCard initial={messaging} tenantSlug={tenant.slug} />}
        <BillingClient
          tenant={tenant}
          plans={plans}
          renewalDate={renewalDate}
          priceInrMonth={priceInrMonth}
          paymentsEnabled={process.env.ECOM_PAYMENTS_ENABLED === 'true'}
        />
      </div>
    </>
  )
}
