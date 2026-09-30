import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import Link from 'next/link'
import CouponForm from '../CouponForm'
import { createCoupon } from './actions'

export const dynamic = 'force-dynamic'

export default async function AddCouponPage() {
  const host = await getHost()
  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={ap('/admin/coupons', host)}
          className="text-foreground-muted hover:text-foreground transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-secondary-500 dark:text-foreground">Add Coupon</h1>
          <p className="text-sm text-foreground-secondary mt-0.5">Create a new discount coupon</p>
        </div>
      </div>

      <CouponForm action={createCoupon} submitLabel="Save as Draft" showUserSelector />
    </div>
  )
}
