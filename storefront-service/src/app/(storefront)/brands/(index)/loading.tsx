import { TaxonomyIndexSkeleton } from '@/components/visitor/skeletons/listing'
import { studioSkeleton } from '@/components/visitor/skeletons/studio'

// In (index) so this skeleton covers /brands only: above [slug] it was sent first on every detail page.
export default async function Loading() {
  const own = <TaxonomyIndexSkeleton kind="brand" title="All Brands" subtitle="Browse products by brand" />
  return (await studioSkeleton('brands', own)) ?? own
}
