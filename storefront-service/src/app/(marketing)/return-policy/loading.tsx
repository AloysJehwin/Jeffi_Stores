import { studioSkeleton } from '@/components/visitor/skeletons/studio'
import { LegalDocSkeleton } from '../legal/LegalSkeletons'

// Redirects to /legal/return-refund-policy when the store has no returns page.
export default async function Loading() {
  return (await studioSkeleton('returns')) ?? <LegalDocSkeleton />
}
