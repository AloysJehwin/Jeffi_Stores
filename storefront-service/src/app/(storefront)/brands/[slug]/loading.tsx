import { TaxonomyDetailSkeleton } from '@/components/visitor/skeletons/listing'
import { listingInserts } from '@/components/visitor/skeletons/sections'
import { studioSkeleton } from '@/components/visitor/skeletons/studio'
import { getLayoutSections } from '@/lib/catalog/homepage-layout'
import { getWebSurface } from '@/lib/catalog/web-surface'

export default async function Loading() {
  const studio = await studioSkeleton('brand', <TaxonomyDetailSkeleton kind="brand" />)
  if (studio) return studio
  const sections = (await getLayoutSections('brand', 'store', await getWebSurface())) ?? []
  return <TaxonomyDetailSkeleton kind="brand" grid={listingInserts(sections, { count: 8, pageSize: 25 })} />
}
