import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { requireStore } from '@controller/lib/ecom/require-store'
import { hasOwnDelhiveryToken } from '@/lib/integrations/resolve'
import PageHeader from '../_components/PageHeader'
import DeliveryAccount from '../DeliveryAccount'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Delivery' }

export default async function DeliveryPage() {
  const { tenant } = await loadOwnerContext()
  requireStore(tenant)
  const ownDelhivery = tenant.own_delhivery === true
  const tokenConnected = ownDelhivery ? await hasOwnDelhiveryToken(tenant.id) : false
  return (
    <>
      <PageHeader eyebrow="Store" title="Delivery" description="Delhivery shipments and tracking for your orders." />
      <DeliveryAccount tenantId={tenant.id} ownDelhivery={ownDelhivery} tokenConnected={tokenConnected} />
    </>
  )
}
