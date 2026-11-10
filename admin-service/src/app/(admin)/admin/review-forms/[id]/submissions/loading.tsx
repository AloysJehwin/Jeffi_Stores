import { PageLoading } from '@/components/admin/kit/skeleton'
import { SubmissionCardsLoading, SubmissionFilterLoading } from './SubmissionsLoading'

export default function Loading() {
  return (
    <PageLoading back="Review Forms">
      <SubmissionFilterLoading />
      <SubmissionCardsLoading />
    </PageLoading>
  )
}
