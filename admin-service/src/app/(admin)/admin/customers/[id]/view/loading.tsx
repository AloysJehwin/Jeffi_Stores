import { LoadingKpis, LoadingLines, LoadingSection, LoadingSplit, LoadingTable, PageLoading, Sk } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading back="Customers">
      <LoadingKpis labels={['Total orders', 'Lifetime spend', 'Avg. order', 'Member since']} />
      <LoadingSplit
        main={
          <>
            <LoadingSection title="About this customer" lines={3} />
            <LoadingSection title="Conversation history">
              <div className="mb-4 flex flex-wrap gap-1.5">
                {[0, 1, 2, 3].map(i => (
                  <Sk key={i} className="h-6 w-14 rounded-full" />
                ))}
              </div>
              <LoadingLines lines={4} />
            </LoadingSection>
            <LoadingSection title="Activity Timeline" lines={4} />
            <LoadingSection title="Orders">
              <LoadingTable bare rows={5} columns={['Order #', 'Date', 'Total', 'Payment', 'Status']} />
            </LoadingSection>
          </>
        }
        aside={
          <>
            <LoadingSection title="Health Score" lines={3} />
            <LoadingSection title="Account actions" lines={2} />
            <LoadingSection title="Tags" lines={1} />
            <div className="rounded-xl border border-border-default bg-surface-elevated p-5">
              <LoadingLines lines={3} />
            </div>
            <LoadingSection title="Tasks" lines={3} />
          </>
        }
      />
    </PageLoading>
  )
}
