import { PageLoading } from '@/components/admin/kit/skeleton'
import { LoadingOverview, LoadingTabBar, LoadingTableCard } from '../products/_components/loading-parts'

export default function Loading() {
  return (
    <PageLoading title="Brands" description="Manage product brands">
      <LoadingTabBar tabs={['Overview', 'Brands', 'Drafts']} actions={2} />
      <LoadingOverview
        kpis={['Active brands', 'Active products', 'Stock value', 'Sales', 'Empty', 'Unused']}
        panel={<LoadingTableCard title="Top brands by sales" columns={['Brand', 'Products', 'Stock', 'Sales', 'vs prev', 'Margin']} />}
      />
    </PageLoading>
  )
}
