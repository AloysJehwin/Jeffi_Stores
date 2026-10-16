import { priceList } from '@jeffi/pricing'
import { loadOwnerContext } from '@/lib/ecom/owner-context'
import { serviceStates } from '@/lib/ecom/service-states'
import PageHeader from '../_components/PageHeader'
import ServicesClient from './ServicesClient'

export const dynamic = 'force-dynamic'

export default async function ServicesPage() {
  const { tenant } = await loadOwnerContext()
  return (
    <>
      <PageHeader eyebrow="Developers" title="Services" description="Messaging and Documents are pay-per-use APIs, billed from your wallet. Add one here; it goes live once Jeffi approves it." />
      <ServicesClient states={await serviceStates(tenant)} prices={priceList()} />
    </>
  )
}
