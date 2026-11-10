import { LoadingFacts, LoadingKpis, LoadingSection, LoadingSplit, PageLoading } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading back="Business Customers">
      <LoadingKpis labels={['GST number', 'Industry', 'Contact', 'Discounts set']} />
      <LoadingSplit
        main={
          <>
            <LoadingSection title="Business profile">
              <LoadingFacts labels={['Company name', 'GST number', 'Industry', 'Phone', 'Email', 'Contact person', 'Business address']} />
            </LoadingSection>
            <LoadingSection title="Category discounts" lines={3} />
          </>
        }
        aside={
          <>
            <LoadingSection title="Approval" lines={2} />
            <LoadingSection title="Recent changes" lines={3} />
          </>
        }
      />
    </PageLoading>
  )
}
