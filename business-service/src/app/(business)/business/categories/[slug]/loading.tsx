import { TaxonomyDetailSkeleton } from '@/components/visitor/skeletons/listing'

export default function Loading() {
  return (
    <TaxonomyDetailSkeleton
      kind="category"
      gridClassName="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6"
    />
  )
}
