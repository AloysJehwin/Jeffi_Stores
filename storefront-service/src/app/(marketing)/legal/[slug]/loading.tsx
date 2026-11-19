import { studioSkeleton } from '@/components/visitor/skeletons/studio'
import { LegalDocSkeleton } from '../LegalSkeletons'

export default async function Loading() {
  return (await studioSkeleton('legal', <LegalDocSkeleton />)) ?? <LegalDocSkeleton />
}
