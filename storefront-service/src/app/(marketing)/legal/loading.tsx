import { studioSkeleton } from '@/components/visitor/skeletons/studio'
import { LegalIndexSkeleton } from './LegalSkeletons'

export default async function Loading() {
  return (await studioSkeleton('legal', <LegalIndexSkeleton />)) ?? <LegalIndexSkeleton />
}
