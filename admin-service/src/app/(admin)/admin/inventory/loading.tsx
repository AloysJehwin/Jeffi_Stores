import { LoadingTabs, LoadingToolbar, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import InventoryOverviewSkeleton from './_components/InventoryOverviewSkeleton'

export default function Loading() {
  return (
    <PageLoading title="Inventory" description="Stock levels, movements and valuation">
      <LoadingTabs tabs={['Overview', 'Stock ledger', 'Valuation']} />
      <Sk className="h-9 w-full max-w-xl rounded-lg" />
      <LoadingToolbar filters={2} />
      <InventoryOverviewSkeleton />
    </PageLoading>
  )
}
