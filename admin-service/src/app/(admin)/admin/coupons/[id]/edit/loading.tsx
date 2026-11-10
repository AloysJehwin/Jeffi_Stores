import { LoadingTable, PageLoading } from '@/components/admin/kit/skeleton'
import CouponFormLoading from '../../_components/CouponFormLoading'

export default function Loading() {
  return (
    <PageLoading back="Coupons">
      <CouponFormLoading footer={false} />
      <div className="min-w-0 rounded-xl border border-border-default bg-surface-elevated">
        <h2 className="px-5 pb-3 pt-4 text-sm font-semibold uppercase tracking-wide text-foreground">Eligible Users</h2>
        <LoadingTable columns={['User', 'Email', 'Redeemed']} rows={5} bare />
      </div>
    </PageLoading>
  )
}
