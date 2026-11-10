import { PageLoading } from '@/components/admin/kit/skeleton'
import ReviewFormFormLoading from '../../_components/ReviewFormFormLoading'

export default function Loading() {
  return (
    <PageLoading back="Review Forms">
      <ReviewFormFormLoading />
    </PageLoading>
  )
}
