import { TaxonomyDetailSkeleton } from '@/components/visitor/skeletons/listing'
import { listingInserts } from '@/components/visitor/skeletons/sections'
import { getLayoutSections } from '@/lib/catalog/homepage-layout'
import { getWebSurface } from '@/lib/catalog/web-surface'

export default async function Loading() {
  const sections = (await getLayoutSections('brand', 'store', await getWebSurface())) ?? []
  return <TaxonomyDetailSkeleton kind="brand" grid={listingInserts(sections, { count: 8, pageSize: 25 })} />
}
