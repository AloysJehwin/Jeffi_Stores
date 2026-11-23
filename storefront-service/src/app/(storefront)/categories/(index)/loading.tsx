import { TaxonomyIndexSkeleton } from '@/components/visitor/skeletons/listing'
import { studioSkeleton } from '@/components/visitor/skeletons/studio'

// In (index) so this skeleton covers /categories only: above [slug] it was sent first on every detail page.
export default async function Loading() {
  const own = <TaxonomyIndexSkeleton kind="category" title="All Categories" subtitle="Browse our complete range of product categories" />
  return (await studioSkeleton('categories', own)) ?? own
}
