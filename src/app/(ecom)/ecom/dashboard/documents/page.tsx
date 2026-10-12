import { loadOwnerContext } from '@/lib/ecom/owner-context'
import { hasService } from '@/lib/tenant-registry'
import PageHeader from '../_components/PageHeader'
import DocumentsClient from './DocumentsClient'

export const dynamic = 'force-dynamic'

export default async function DocumentsPage() {
  const { tenant } = await loadOwnerContext()
  return (
    <>
      <PageHeader eyebrow="Developers" title="Documents" description="Every PDF rendered through your API keys, with a shareable link." />
      {hasService(tenant, 'documents') ? <DocumentsClient /> : <p className="text-sm text-foreground-secondary">Documents is not enabled. Turn it on from API keys.</p>}
    </>
  )
}
