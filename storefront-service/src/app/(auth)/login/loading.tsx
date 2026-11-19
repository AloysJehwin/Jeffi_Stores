import { StoreAuthSkeleton } from '@/components/visitor/skeletons/auth'
import { studioSkeleton } from '@/components/visitor/skeletons/studio'

export default async function Loading() {
  return (await studioSkeleton('login', <StoreAuthSkeleton kind="login" />)) ?? <StoreAuthSkeleton kind="login" />
}
