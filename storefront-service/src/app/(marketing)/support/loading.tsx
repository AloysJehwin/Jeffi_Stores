import { SupportSkeleton } from '@/components/visitor/skeletons/marketing'
import { studioSkeleton } from '@/components/visitor/skeletons/studio'

export default async function Loading() {
  return (await studioSkeleton('support')) ?? <SupportSkeleton />
}
