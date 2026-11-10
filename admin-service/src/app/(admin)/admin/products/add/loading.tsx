import { PageLoading } from '@/components/admin/kit/skeleton'
import ProductFormLoading from '../_components/ProductFormLoading'

export default function Loading() {
  return (
    <PageLoading back="Products" title="Add New Product" description="Create a new product in your inventory">
      <ProductFormLoading />
    </PageLoading>
  )
}
