import { ProductsListingSkeleton } from '@/components/visitor/skeletons/listing'
import { listingInserts } from '@/components/visitor/skeletons/sections'
import { getLayoutSections } from '@/lib/catalog/homepage-layout'
import { LISTING_PAGE_SIZE } from '@/lib/catalog/listing-model'
import { getWebSurface } from '@/lib/catalog/web-surface'

export default async function Loading() {
  const sections = (await getLayoutSections('products', 'store', await getWebSurface())) ?? []
  return <ProductsListingSkeleton grid={listingInserts(sections, { pageSize: LISTING_PAGE_SIZE })} />
}
