import { LoadingFacts, LoadingLines, LoadingSection, LoadingSplit, PageLoading, Sk } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading back="Orders" actions={3}>
      <LoadingSplit
        main={
          <>
            <LoadingSection title="Order Items">
              <div className="space-y-4">
                {[0, 1, 2].map(i => (
                  <div key={i} className="flex items-start gap-3">
                    <Sk className="h-14 w-14 shrink-0 rounded-lg" />
                    <div className="flex-1">
                      <LoadingLines lines={2} />
                    </div>
                  </div>
                ))}
              </div>
            </LoadingSection>
            <LoadingSection title="Update Order Status" lines={3} />
            <LoadingSection title="Order Notes" lines={2} />
            <LoadingSection title="Change log" lines={3} />
          </>
        }
        aside={
          <>
            <LoadingSection title="Status history" lines={4} />
            <LoadingSection title="Customer">
              <LoadingFacts labels={['Name', 'Email', 'Phone']} />
            </LoadingSection>
            <LoadingSection title="Billing Address" lines={3} />
            <LoadingSection title="Shipping Address" lines={3} />
            <LoadingSection title="Payment">
              <LoadingFacts labels={['Status', 'Method', 'Transaction ID']} />
            </LoadingSection>
          </>
        }
      />
    </PageLoading>
  )
}
