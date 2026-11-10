import { LoadingToolbar, PageLoading } from '@/components/admin/kit/skeleton'
import { LoadingPeriodBar, LoadingTabBar } from './_components/loading-parts'
import ProductsOverviewLoading from './_components/ProductsOverviewLoading'

export default function Loading() {
  return (
    <PageLoading title="Products" description="Manage your product inventory">
      <LoadingTabBar tabs={['Overview', 'Products', 'Drafts']} actions={1} />
      <div className="space-y-4">
        <LoadingPeriodBar />
        <LoadingToolbar filters={1} />
        <ProductsOverviewLoading />
      </div>
    </PageLoading>
  )
}
