import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { hasService } from '@/lib/tenant-registry'
import { serviceStates } from '@controller/lib/ecom/service-states'
import PageHeader from '../_components/PageHeader'
import ApiKeysClient from './ApiKeysClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'API keys' }

export default async function ApiKeysPage() {
  const { tenant } = await loadOwnerContext()
  const services = { messaging: hasService(tenant, 'messaging'), documents: hasService(tenant, 'documents') }
  const states = await serviceStates(tenant)
  return (
    <>
      <PageHeader eyebrow="Developers" title="API keys" description="Keys for public.jeffistores.in. Each key is shown once — store it somewhere safe." />
      <ApiKeysClient services={services} approved={states.messaging.status === 'live' || states.documents.status === 'live'} docsUrl={process.env.NEXT_PUBLIC_PUBLIC_API_URL ?? 'https://public.jeffistores.in'} />
    </>
  )
}
