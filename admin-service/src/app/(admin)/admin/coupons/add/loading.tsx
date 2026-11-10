import { PageLoading } from '@/components/admin/kit/skeleton'
import CouponFormLoading from '../_components/CouponFormLoading'

export default function Loading() {
  return (
    <PageLoading back="Coupons" title="Add Coupon" description="Create a new discount coupon">
      <CouponFormLoading />
    </PageLoading>
  )
}
