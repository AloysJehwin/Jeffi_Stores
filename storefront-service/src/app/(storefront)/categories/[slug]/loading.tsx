import { TaxonomyDetailSkeleton } from '@/components/visitor/skeletons/listing'
import { listingInserts } from '@/components/visitor/skeletons/sections'
import { getLayoutSections } from '@/lib/catalog/homepage-layout'
import { LISTING_PAGE_SIZE } from '@/lib/catalog/listing-model'
import { getWebSurface } from '@/lib/catalog/web-surface'

export default async function Loading() {
  const sections = (await getLayoutSections('category', 'store', await getWebSurface())) ?? []
  return <TaxonomyDetailSkeleton kind="category" toolbar grid={listingInserts(sections, { count: 8, pageSize: LISTING_PAGE_SIZE })} />
}
