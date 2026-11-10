import { LoadingTabs, LoadingToolbar, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import InvoicesOverviewSkeleton from './_components/InvoicesOverviewSkeleton'

export default function Loading() {
  return (
    <PageLoading title="Invoices" description="All online and offline invoices">
      <LoadingTabs tabs={['Overview', 'Invoices', 'Drafts']} />
      <Sk className="h-control w-full max-w-2xl rounded-lg" />
      <LoadingToolbar filters={2} />
      <InvoicesOverviewSkeleton />
    </PageLoading>
  )
}
