import { PageLoading } from '@/components/admin/kit/skeleton'
import { CategoryFormLoading } from '../_components/CategoryFormLoading'

export default function Loading() {
  return (
    <PageLoading back="Categories" title="Add New Category" description="Create a new product category">
      <CategoryFormLoading />
    </PageLoading>
  )
}
