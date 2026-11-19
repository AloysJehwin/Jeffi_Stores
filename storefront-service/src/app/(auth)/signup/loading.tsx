import { StoreAuthSkeleton } from '@/components/visitor/skeletons/auth'
import { studioSkeleton } from '@/components/visitor/skeletons/studio'

export default async function Loading() {
  return (await studioSkeleton('signup', <StoreAuthSkeleton kind="signup" />)) ?? <StoreAuthSkeleton kind="signup" />
}
