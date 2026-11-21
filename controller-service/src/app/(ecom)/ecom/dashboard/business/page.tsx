import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { hasService } from '@/lib/tenant-registry'
import { loadKybView } from '@controller/lib/kyb/view'
import { todayIst } from '@controller/lib/catalog/compliance'
import PageHeader from '../_components/PageHeader'
import { Badge } from '../../onboard/ui'
import BusinessClient from './BusinessClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Business verification' }

const DESCRIPTION = 'Jeffi verifies the business behind each service before switching it on. Save each part as you go; documents are checked as soon as you upload them.'

export default async function BusinessPage({ searchParams }: { searchParams: Promise<{ for?: string }> }) {
  const { for: wanted } = await searchParams
  const { owner, tenant } = await loadOwnerContext()
  const kyb = await loadKybView(tenant, owner.id)
  const focus = wanted === 'messaging' || wanted === 'documents' ? wanted : null
  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Business verification"
        description={DESCRIPTION}
        actions={kyb.status === 'approved' ? <Badge tone="sage">Business approved</Badge> : kyb.status === 'rejected' ? <Badge tone="red">Not approved</Badge> : null}
      />
      <BusinessClient initial={kyb} focus={focus} slug={tenant.slug} hasStore={hasService(tenant, 'store')} today={todayIst()} />
    </>
  )
}
