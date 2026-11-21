import { priceList } from '@jeffi/pricing'
import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { serviceStates } from '@controller/lib/ecom/service-states'
import { loadKybView } from '@controller/lib/kyb/view'
import PageHeader from '../_components/PageHeader'
import ServicesClient from './ServicesClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Services' }

export default async function ServicesPage() {
  const { owner, tenant } = await loadOwnerContext()
  const [states, kyb] = await Promise.all([serviceStates(tenant), loadKybView(tenant, owner.id).catch(() => null)])
  return (
    <>
      <PageHeader eyebrow="Developers" title="Services" description="Messaging and Documents are pay-per-use APIs, billed from your wallet. Verify your business, then add one here; it goes live once Jeffi approves it." />
      <ServicesClient states={states} prices={priceList()} kyb={kyb && { services: kyb.services, items: kyb.items }} />
    </>
  )
}
