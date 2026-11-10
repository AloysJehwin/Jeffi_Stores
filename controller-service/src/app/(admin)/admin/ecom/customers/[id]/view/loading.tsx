import { LoadingTabs } from '@/components/admin/kit/skeleton'
import { TENANT_TABS } from '@controller/components/admin/ecom/EcomUI'
import { OverviewTabLoading, TenantDetailLoading } from '../../../_components/detail-skeletons'

// Messaging only shows for stores that use it, so it is left out here.
export default function Loading() {
  return (
    <TenantDetailLoading back="Stores" section="store">
      <LoadingTabs tabs={TENANT_TABS.filter(t => t.key !== 'messaging').map(t => t.label)} />
      <OverviewTabLoading />
    </TenantDetailLoading>
  )
}
