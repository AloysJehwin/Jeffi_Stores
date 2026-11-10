import { LoadingFacts, LoadingSection, LoadingSplit, LoadingTable, PageLoading } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading back="Invoices" actions={1}>
      <LoadingSplit
        main={
          <LoadingSection title="Line Items">
            <LoadingTable bare rows={4} columns={['Item', 'GST%', 'Qty', 'Unit Price', 'Taxable', 'Tax', 'Total']} />
          </LoadingSection>
        }
        aside={
          <>
            <LoadingSection title="Sale Details">
              <LoadingFacts labels={['Invoice #', 'Sale #', 'Date', 'Payment']} />
            </LoadingSection>
            <LoadingSection title="Customer">
              <LoadingFacts labels={['Name']} />
            </LoadingSection>
          </>
        }
      />
    </PageLoading>
  )
}
