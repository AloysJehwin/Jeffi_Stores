import { AccountHomeSkeleton } from '@/components/visitor/skeletons/account'
import { studioSkeleton } from '@/components/visitor/skeletons/studio'

export default async function Loading() {
  return (await studioSkeleton('account', <AccountHomeSkeleton />)) ?? <AccountHomeSkeleton />
}
