import { OrdersListSkeleton } from '@/components/visitor/skeletons/account'
import { studioSkeleton } from '@/components/visitor/skeletons/studio'

// The store's AI-designed account pages frame this one (renderAccountFrame).
export default async function Loading() {
  return (await studioSkeleton('account', <OrdersListSkeleton />)) ?? <OrdersListSkeleton />
}
