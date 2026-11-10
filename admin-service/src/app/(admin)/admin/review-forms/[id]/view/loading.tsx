import { LoadingLines, PageLoading } from '@/components/admin/kit/skeleton'
import { LoadingCard, LoadingEntitySplit, LoadingFields, LoadingRecentChanges } from '../../../products/_components/loading-parts'

export default function Loading() {
  return (
    <PageLoading back="Review Forms" actions={1}>
      <LoadingEntitySplit
        main={
          <LoadingCard title="Questions">
            <LoadingLines lines={4} />
          </LoadingCard>
        }
        aside={
          <>
            <LoadingCard title="Details">
              <LoadingFields cols={1} labels={['Template', 'Coupon', 'Google URL', 'Submissions', 'Public link']} />
            </LoadingCard>
            <LoadingRecentChanges />
          </>
        }
      />
    </PageLoading>
  )
}
