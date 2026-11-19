import { CheckoutSkeleton } from '@/components/visitor/skeletons/commerce'
import { studioSkeleton } from '@/components/visitor/skeletons/studio'

export default async function Loading() {
  return (await studioSkeleton('checkout', <CheckoutSkeleton />)) ?? <CheckoutSkeleton />
}
