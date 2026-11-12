import { HomeLayoutSkeleton } from '@/components/visitor/skeletons/sections'
import { getLayoutSections } from '@/lib/catalog/homepage-layout'
import { getWebSurface } from '@/lib/catalog/web-surface'

// The published layout's shape (cached per tenant; see homepage-layout.ts), on the surface this
// browser gets, so the page lands on it without shifting.
export default async function Loading() {
  const sections = (await getLayoutSections('home', 'store', await getWebSurface())) ?? []
  return <HomeLayoutSkeleton sections={sections} />
}
