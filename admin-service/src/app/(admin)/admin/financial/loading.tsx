import { LoadingTabs, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import { OverviewTabSkeleton } from './_components/FinanceSkeletons'

export default function Loading() {
  return (
    <PageLoading title="Financial" description="Receivables, payables, P&L and cashflow">
      <LoadingTabs tabs={['Overview', 'Receivables', 'Payables', 'Transactions', 'P&L', 'Cashflow', 'COD Remittance', 'Marketplaces', 'Disputes', 'Messaging', 'AI costs']} />
      <Sk className="h-control w-full max-w-2xl rounded-lg" />
      <OverviewTabSkeleton />
    </PageLoading>
  )
}
