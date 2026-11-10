import { PageLoading } from '@/components/admin/kit/skeleton'
import { CategoryFormLoading } from '../../_components/CategoryFormLoading'

export default function Loading() {
  return (
    <PageLoading back="Categories" description="Changes are saved to the draft only">
      <CategoryFormLoading />
    </PageLoading>
  )
}
