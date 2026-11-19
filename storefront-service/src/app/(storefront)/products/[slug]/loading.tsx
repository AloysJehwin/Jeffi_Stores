import { ProductDetailSkeleton } from '@/components/visitor/skeletons/product'
import { studioSkeleton } from '@/components/visitor/skeletons/studio'

export default async function Loading() {
  return (await studioSkeleton('product', <ProductDetailSkeleton />)) ?? <ProductDetailSkeleton />
}
