import { LoadingFacts, LoadingSection, LoadingSplit, LoadingTable, PageLoading } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading back="Invoices" actions={3}>
      <LoadingSplit
        main={
          <>
            <LoadingSection title="Line items">
              <LoadingTable bare rows={4} columns={['Item', 'HSN', 'GST%', 'Qty', 'Unit price', 'Taxable', 'Tax', 'Total']} />
            </LoadingSection>
            <LoadingSection title="Change log" lines={3} />
          </>
        }
        aside={
          <>
            <LoadingSection title="Invoice details">
              <LoadingFacts labels={['Invoice #', 'Order #', 'Date', 'Source', 'IRN']} />
            </LoadingSection>
            <LoadingSection title="Customer">
              <LoadingFacts labels={['Name', 'Phone', 'Email', 'Address']} />
            </LoadingSection>
          </>
        }
      />
    </PageLoading>
  )
}
