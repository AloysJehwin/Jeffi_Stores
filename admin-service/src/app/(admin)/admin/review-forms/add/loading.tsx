import { PageLoading } from '@/components/admin/kit/skeleton'
import ReviewFormFormLoading from '../_components/ReviewFormFormLoading'

export default function Loading() {
  return (
    <PageLoading back="Review Forms" title="Create Review Form" description="Build a shareable form to collect Google reviews">
      <ReviewFormFormLoading />
    </PageLoading>
  )
}
