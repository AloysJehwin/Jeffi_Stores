import { BusinessHomeSkeleton } from '@/components/visitor/skeletons/marketing'
import { getLayoutSections } from '@/lib/catalog/homepage-layout'
import { getWebSurface } from '@/lib/catalog/web-surface'

// The published business homepage's shape; the generic skeleton while none is published
// (the page then shows the landing or the catalog).
export default async function Loading() {
  const sections = await getLayoutSections('home', 'business', await getWebSurface())
  return <BusinessHomeSkeleton sections={sections} />
}
