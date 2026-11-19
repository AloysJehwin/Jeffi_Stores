import { OrderDetailSkeleton } from '@/components/visitor/skeletons/account'
import { studioSkeleton } from '@/components/visitor/skeletons/studio'

export default async function Loading() {
  return (await studioSkeleton('track', <OrderDetailSkeleton />)) ?? <OrderDetailSkeleton />
}
