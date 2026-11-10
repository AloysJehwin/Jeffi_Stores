import { LoadingFacts, LoadingKpis, LoadingSection, LoadingSplit, LoadingTable, PageLoading } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading back="Financial">
      <LoadingKpis labels={['Total', 'Paid', 'Remaining']} />
      <LoadingSplit
        main={
          <LoadingSection title="Payment History">
            <LoadingTable bare rows={4} columns={['Date', 'Method', 'Amount', 'Reference / UTR', 'Payout ID', 'Status']} />
          </LoadingSection>
        }
        aside={
          <>
            <LoadingSection title="Bill Details">
              <LoadingFacts labels={['Supplier', 'GSTIN', 'Bill Date', 'Due Date']} />
            </LoadingSection>
            <LoadingSection title="Amounts">
              <LoadingFacts labels={['Base Amount', 'Tax', 'Total', 'Paid']} />
            </LoadingSection>
          </>
        }
      />
    </PageLoading>
  )
}
