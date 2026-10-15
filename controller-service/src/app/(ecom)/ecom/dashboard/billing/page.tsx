import { loadOwnerContext } from '@/lib/ecom/owner-context'
import { listPlans } from '@/lib/tenant-registry'
import { getSubscription } from '@/lib/payments/razorpay-subscriptions'
import PageHeader from '../_components/PageHeader'
import BillingClient from './BillingClient'

export const dynamic = 'force-dynamic'

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant: tenantSlug } = await searchParams
  const { tenant } = await loadOwnerContext({ tenantSlug })
  const plans = await listPlans()

  let renewalDate: string | null = null
  if (tenant.razorpay_subscription_id && tenant.subscription_status === 'active') {
    const sub = await getSubscription(tenant.razorpay_subscription_id).catch(() => null)
    if (sub?.current_end) {
      renewalDate = new Date(sub.current_end * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    }
  }

  return (
    <>
      <PageHeader eyebrow="Account" title="Billing" description="Your plan, renewal and subscription controls." />
      <BillingClient tenant={tenant} plans={plans} renewalDate={renewalDate} />
    </>
  )
}
