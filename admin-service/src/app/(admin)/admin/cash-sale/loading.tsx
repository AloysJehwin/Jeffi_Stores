import { LoadingTable, LoadingTabs, LoadingToolbar, PageLoading } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading title="Cash Sales" description="Walk-in sales — no customer details">
      <LoadingTabs tabs={['New sale', 'Held bills', 'Overview']} />
      <LoadingToolbar filters={2} />
      <LoadingTable columns={['Receipt No', 'Date', 'Customer', 'Amount', 'Payment', 'Actions']} />
    </PageLoading>
  )
}
