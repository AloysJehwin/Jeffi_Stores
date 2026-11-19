import { AboutSkeleton } from '@/components/visitor/skeletons/marketing'
import { studioSkeleton } from '@/components/visitor/skeletons/studio'

export default async function Loading() {
  return (await studioSkeleton('about')) ?? <AboutSkeleton />
}
