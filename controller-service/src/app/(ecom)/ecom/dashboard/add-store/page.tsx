import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { hasService } from '@/lib/tenant-registry'
import { paymentRequired } from '@/lib/billing/payment-required'
import { StatusPill } from '@controller/components/admin/ecom/EcomUI'
import PageHeader from '../_components/PageHeader'
import { Card } from '../_components/Card'
import AddStoreClient from './AddStoreClient'
import { primaryBtn } from '../../onboard/ui'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Add a store' }

export default async function AddStorePage() {
  const { tenant } = await loadOwnerContext()
  // Mandatory: checkout after approval. Optional: approval starts the build. Under review, payment is assumed.
  const payments = paymentRequired(tenant)
  if (hasService(tenant, 'store') && !tenant.store_request) {
    return (
      <>
        <PageHeader eyebrow="Store" title="Your store" actions={<StatusPill status={tenant.status} />} />
        <Card>
          <p className="text-sm text-foreground-secondary">
            {tenant.status === 'active'
              ? `Live at ${tenant.slug}.jeffistores.in.`
              : tenant.status === 'pending_approval'
                ? 'Your store is under review. We email you when it is approved and ready for payment.'
                : tenant.status === 'awaiting_payment'
                  ? payments
                    ? 'Approved — complete the subscription payment from the onboarding page to start provisioning.'
                    : 'Approved — your store setup is starting. Billing starts later.'
                  : tenant.status === 'provisioning'
                    ? `Setting up ${tenant.slug}.jeffistores.in. We email you when it is live.`
                    : `Status: ${tenant.status}.`}
          </p>
          {payments && tenant.status === 'awaiting_payment' && <a href="/onboard" className={`${primaryBtn} mt-4`}>Complete payment →</a>}
        </Card>
      </>
    )
  }
  if (tenant.store_request === 'awaiting_payment') {
    return (
      <>
        <PageHeader eyebrow="Store" title="Add an online store" />
        <Card>
          <p className="text-sm text-foreground-secondary">
            {!payments
              ? 'Approved — your store setup is starting. Billing starts later.'
              : tenant.subscription_status === 'active'
                ? 'Payment confirmed — provisioning your store. This takes a few minutes.'
                : 'Approved — complete the subscription payment from the onboarding page to start provisioning.'}
          </p>
          {payments && tenant.subscription_status !== 'active' && <a href="/onboard" className={`${primaryBtn} mt-4`}>Complete payment →</a>}
        </Card>
      </>
    )
  }
  return (
    <>
      <PageHeader eyebrow="Store" title="Add an online store" description={`Your store will live at ${tenant.slug}.jeffistores.in and share this workspace's wallet, API keys and business details.`} />
      <AddStoreClient tenant={tenant} />
    </>
  )
}
