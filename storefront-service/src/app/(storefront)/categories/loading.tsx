import { TaxonomyIndexSkeleton } from '@/components/visitor/skeletons/listing'
import { studioSkeleton } from '@/components/visitor/skeletons/studio'

export default async function Loading() {
  const own = <TaxonomyIndexSkeleton kind="category" title="All Categories" subtitle="Browse our complete range of product categories" />
  return (await studioSkeleton('categories', own)) ?? own
}
