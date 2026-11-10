import { LoadingFacts, LoadingKpis, LoadingLines, LoadingSection, LoadingSplit, PageLoading, Sk } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading back="Business RFQs" actions={2}>
      <LoadingKpis labels={['Items', 'Customer price total', 'Requested value', 'GST number']} />
      <LoadingSplit
        main={
          <>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Requested items</h2>
            {[0, 1, 2].map(i => (
              <div key={i} className="flex items-start gap-3 rounded-xl border border-border-default bg-surface-elevated p-4">
                <Sk className="h-14 w-14 shrink-0 rounded-lg" />
                <div className="flex-1">
                  <LoadingLines lines={3} />
                </div>
              </div>
            ))}
          </>
        }
        aside={
          <>
            <LoadingSection title="From">
              <LoadingFacts labels={['Company', 'Contact', 'Email', 'Phone', 'GST']} />
            </LoadingSection>
            <LoadingSection title="Negotiation thread" lines={4} />
            <LoadingSection title="Recent changes" lines={3} />
          </>
        }
      />
    </PageLoading>
  )
}
