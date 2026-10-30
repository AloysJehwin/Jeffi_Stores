import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { hasService } from '@/lib/tenant-registry'
import { StatusPill } from '@controller/components/admin/ecom/EcomUI'
import PageHeader from '../_components/PageHeader'
import { Card } from '../_components/Card'
import AddStoreClient from './AddStoreClient'

export const dynamic = 'force-dynamic'

export default async function AddStorePage() {
  const { tenant } = await loadOwnerContext()
  if (hasService(tenant, 'store') && !tenant.store_request) {
    return (
      <>
        <PageHeader eyebrow="Store" title="Your store" actions={<StatusPill status={tenant.status} />} />
        <Card>
          <p className="text-sm text-foreground-secondary">
            {tenant.status === 'active' ? `Live at ${tenant.slug}.jeffistores.in.` : tenant.status === 'pending_approval' ? 'Your store is under review. We email you when it is approved and ready for payment.' : tenant.status === 'awaiting_payment' ? 'Approved — complete the subscription payment from the onboarding page to start provisioning.' : `Status: ${tenant.status}.`}
          </p>
          {tenant.status === 'awaiting_payment' && <a href="/onboard" className="ecom-accent-bg inline-block mt-4 rounded-full px-5 py-2 text-sm font-semibold text-white">Complete payment →</a>}
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
