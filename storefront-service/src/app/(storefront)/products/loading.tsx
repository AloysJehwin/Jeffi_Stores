import { ProductsListingSkeleton } from '@/components/visitor/skeletons/listing'
import { listingInserts } from '@/components/visitor/skeletons/sections'
import { studioSkeleton } from '@/components/visitor/skeletons/studio'
import { getLayoutSections } from '@/lib/catalog/homepage-layout'
import { LISTING_PAGE_SIZE } from '@/lib/catalog/listing-model'
import { getWebSurface } from '@/lib/catalog/web-surface'

export default async function Loading() {
  const studio = await studioSkeleton('products', <ProductsListingSkeleton />)
  if (studio) return studio
  const sections = (await getLayoutSections('products', 'store', await getWebSurface())) ?? []
  return <ProductsListingSkeleton grid={listingInserts(sections, { pageSize: LISTING_PAGE_SIZE })} />
}
