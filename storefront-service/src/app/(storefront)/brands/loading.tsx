import { TaxonomyIndexSkeleton } from '@/components/visitor/skeletons/listing'
import { studioSkeleton } from '@/components/visitor/skeletons/studio'

export default async function Loading() {
  const own = <TaxonomyIndexSkeleton kind="brand" title="All Brands" subtitle="Browse products by brand" />
  return (await studioSkeleton('brands', own)) ?? own
}
