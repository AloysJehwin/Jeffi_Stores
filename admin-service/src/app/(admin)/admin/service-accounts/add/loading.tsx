import { LoadingForm, LoadingSection, PageLoading, Sk } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading back="Service accounts" title="Create Service Account" description="Generate an mTLS client certificate for M2M authentication" actions={1}>
      <LoadingForm sections={[{ title: 'Details', fields: ['Name'], cols: 1 }]} footer={false} />
      <LoadingSection title="Scopes">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <Sk key={i} className="h-7 w-28 rounded-full" />
          ))}
        </div>
      </LoadingSection>
    </PageLoading>
  )
}
