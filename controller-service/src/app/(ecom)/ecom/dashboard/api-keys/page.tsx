import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { hasService } from '@/lib/tenant-registry'
import PageHeader from '../_components/PageHeader'
import ApiKeysClient from './ApiKeysClient'

export const dynamic = 'force-dynamic'

export default async function ApiKeysPage() {
  const { tenant } = await loadOwnerContext()
  const services = { messaging: hasService(tenant, 'messaging'), documents: hasService(tenant, 'documents') }
  return (
    <>
      <PageHeader eyebrow="Developers" title="API keys" description="Keys for public.jeffistores.in. Each key is shown once — store it somewhere safe." />
      <ApiKeysClient services={services} docsUrl={process.env.NEXT_PUBLIC_PUBLIC_API_URL ?? 'https://public.jeffistores.in'} />
    </>
  )
}
