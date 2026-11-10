import { LoadingFacts, LoadingSection, LoadingSplit, LoadingTable, PageLoading } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading back="Subscriptions" actions={2}>
      <LoadingSplit
        main={
          <>
            <LoadingSection title="Details">
              <LoadingFacts labels={['Plan', 'Per cycle', 'Shipping / cycle', 'Type', 'Cycles paid', 'Commitment', 'Current period', 'Access until', 'Collected by', 'Razorpay ID', 'Consent', 'Started']} />
            </LoadingSection>
            <LoadingSection title="Cycles">
              <LoadingTable bare rows={4} columns={['Cycle', 'Charged', 'Amount', 'Payment', 'Order']} />
            </LoadingSection>
          </>
        }
        aside={
          <>
            <LoadingSection title="Customer" lines={3} />
            <LoadingSection title="Delivery address" lines={2} />
            <LoadingSection title="Recent changes" lines={3} />
          </>
        }
      />
    </PageLoading>
  )
}
