import { LoadingSection, LoadingTable, PageLoading, Sk } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading
      title="UPI confirmations"
      description="Payments customers made to your UPI ID. Check the UTR against your bank statement, then approve or reject."
      back="Financial"
    >
      <LoadingSection title="Payments">
        <Sk className="mb-4 h-control w-48 rounded-lg" />
        <LoadingTable bare rows={10} columns={['Order', 'Customer', 'Amount', 'UTR', 'When', 'Status', '']} />
      </LoadingSection>
    </PageLoading>
  )
}
