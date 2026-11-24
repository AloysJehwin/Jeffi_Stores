import { priceList } from '@jeffi/pricing'
import { getTenantWallet } from '@/lib/payments/wallet'
import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { serviceStates } from '@controller/lib/ecom/service-states'
import { hasService } from '@/lib/tenant-registry'
import PageHeader from '../_components/PageHeader'
import ServiceNotOn from '../services/ServiceNotOn'
import MessagingClient from './MessagingClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Messaging' }

export default async function MessagingPage() {
  const { tenant } = await loadOwnerContext()
  if (hasService(tenant, 'messaging')) {
    const wallet = await getTenantWallet(tenant.id, 0).catch(() => null)
    return <MessagingClient prices={{ ...priceList().messages, media: priceList().media }} balance={Number(wallet?.balance ?? 0)} storeName={tenant.display_name} />
  }
  const { messaging } = await serviceStates(tenant)
  return (
    <>
      <PageHeader eyebrow="Developers" title="Messaging" description="Templates, bulk sends and the delivery log for email, SMS and WhatsApp sent through your API keys." />
      <ServiceNotOn service="messaging" state={messaging} />
    </>
  )
}
