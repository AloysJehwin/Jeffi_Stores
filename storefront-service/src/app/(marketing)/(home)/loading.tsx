import { HomeLayoutSkeleton } from '@/components/visitor/skeletons/sections'
import { studioSkeleton } from '@/components/visitor/skeletons/studio'
import { getLayoutSections } from '@/lib/catalog/homepage-layout'
import { getWebSurface } from '@/lib/catalog/web-surface'

// An AI-designed home draws its own skeleton; otherwise the published layout's shape (cached per tenant; see
// homepage-layout.ts), on the surface this browser gets, so the page lands on it without shifting.
export default async function Loading() {
  const studio = await studioSkeleton('home')
  if (studio) return studio
  const sections = (await getLayoutSections('home', 'store', await getWebSurface())) ?? []
  return <HomeLayoutSkeleton sections={sections} />
}
