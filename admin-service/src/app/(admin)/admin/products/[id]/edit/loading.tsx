import { PageLoading } from '@/components/admin/kit/skeleton'
import ProductFormLoading from '../../_components/ProductFormLoading'

export default function Loading() {
  return (
    <PageLoading back="Products">
      <ProductFormLoading edit />
    </PageLoading>
  )
}
