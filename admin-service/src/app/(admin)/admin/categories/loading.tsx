import { PageLoading } from '@/components/admin/kit/skeleton'
import { LoadingOverview, LoadingTabBar, LoadingTableCard } from '../products/_components/loading-parts'

export default function Loading() {
  return (
    <PageLoading title="Categories" description="Manage product categories and subcategories">
      <LoadingTabBar tabs={['Overview', 'Categories', 'Drafts']} actions={2} />
      <LoadingOverview
        kpis={['Active categories', 'Active products', 'Stock value', 'Sales', 'Empty', 'Unused']}
        panel={<LoadingTableCard title="Top categories by sales" columns={['Category', 'Products', 'Stock', 'Sales', 'vs prev', 'Margin']} />}
      />
    </PageLoading>
  )
}
