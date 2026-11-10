import { LoadingFacts, LoadingSection, LoadingSplit, LoadingTable, PageLoading } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading back="Quotations" actions={3}>
      <LoadingSplit
        main={
          <>
            <LoadingSection title="Line items">
              <LoadingTable bare rows={4} columns={['Item', 'HSN', 'GST%', 'Unit', 'Qty', 'Rate', 'Disc%', 'Amount']} />
            </LoadingSection>
            <LoadingSection title="Change log" lines={3} />
          </>
        }
        aside={
          <>
            <LoadingSection title="Quotation details">
              <LoadingFacts labels={['Quote #', 'Date', 'Status']} />
            </LoadingSection>
            <LoadingSection title="Consignee">
              <LoadingFacts labels={['Name', 'Phone', 'Email', 'Address']} />
            </LoadingSection>
          </>
        }
      />
    </PageLoading>
  )
}
