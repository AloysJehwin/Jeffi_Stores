import { SupportSkeleton } from '@/components/visitor/skeletons/marketing'
import { studioSkeleton } from '@/components/visitor/skeletons/studio'

// /contact redirects to /support when the store has no contact page.
export default async function Loading() {
  return (await studioSkeleton('contact')) ?? <SupportSkeleton />
}
