import { loadOwnerContext } from '@/lib/ecom/owner-context'
import { hasService, listServiceApprovals, blockedServices } from '@/lib/tenant-registry'
import PageHeader from '../_components/PageHeader'
import ApiKeysClient from './ApiKeysClient'

export const dynamic = 'force-dynamic'

export default async function ApiKeysPage() {
  const { tenant } = await loadOwnerContext()
  const services = { messaging: hasService(tenant, 'messaging'), documents: hasService(tenant, 'documents') }
  const blocked = blockedServices(await listServiceApprovals(tenant.id).catch(() => []))
  const review = { messaging: blocked.get('messaging') ?? null, documents: blocked.get('documents') ?? null }
  return (
    <>
      <PageHeader eyebrow="Developers" title="API keys" description="Keys for public.jeffistores.in. Each key is shown once — store it somewhere safe." />
      <ApiKeysClient services={services} review={review} docsUrl={process.env.NEXT_PUBLIC_PUBLIC_API_URL ?? 'https://public.jeffistores.in'} />
    </>
  )
}
