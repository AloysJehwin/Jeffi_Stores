import { TaxonomyIndexSkeleton } from '@/components/visitor/skeletons/listing'

export default function Loading() {
  return (
    <TaxonomyIndexSkeleton
      kind="category"
      title="All Categories"
      subtitle="Browse our complete range of product categories"
    />
  )
}
