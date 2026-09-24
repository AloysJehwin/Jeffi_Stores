'use client'

import { useHasScope } from '@/contexts/AdminScopesContext'
import { ap } from '@/lib/admin-path'
import type { DashboardAnalytics } from '@/lib/queries'
import { SectionCard, SectionHeader, CompactStat, MiniStat, pctStr, hoursStr, daysStr, delta, numStr } from './Primitives'

export default function OpsInsights({ data, host }: { data: DashboardAnalytics; host: string }) {
  const { fulfilment: f, attention: a, engagement: e, cash } = data.insights
  const canReturns = useHasScope('returns:read')
  const canReviews = useHasScope('reviews:read')
  const canTasks = useHasScope('tasks:read')
  const canCrm = useHasScope('crm:read')

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
      <SectionCard>
        <SectionHeader title="Fulfilment Speed" actionLabel="Processing" href={ap('/admin/orders?status=processing', host)} />
        <div className="grid grid-cols-2 gap-2">
          <CompactStat label="Time to ship" value={hoursStr(f.avgHoursToShip)} sub={`Prev ${hoursStr(f.avgHoursToShipPrev)}`} pct={delta(f.avgHoursToShip, f.avgHoursToShipPrev)} invert />
          <CompactStat label="Delivery time" value={daysStr(f.avgDaysToDeliver)} sub="ship to doorstep" />
          <CompactStat label="On-time delivery" value={pctStr(f.onTimePct, 0)} sub={f.etaSample ? `${numStr(f.etaSample)} delivered with ETA` : 'no ETA data yet'} />
          <CompactStat label="Via Delhivery" value={numStr(cash.shippedViaDelhivery)} sub="AWBs in range" href={ap('/admin/delhivery', host)} />
        </div>
        <div className="mt-3 pt-3 border-t border-border-default space-y-0.5">
          <MiniStat label="Pending over 24 h" value={numStr(a.pendingOver24h)} tone={a.pendingOver24h ? 'text-amber-600 dark:text-amber-400' : undefined} href={ap('/admin/orders?status=pending', host)} />
          <MiniStat label="Unshipped over 48 h" value={numStr(a.unshippedOver48h)} tone={a.unshippedOver48h ? 'text-red-500 dark:text-red-400' : undefined} href={ap('/admin/orders?status=processing', host)} />
          <MiniStat label="Delivery attempted" value={numStr(a.deliveryAttempted)} tone={a.deliveryAttempted ? 'text-amber-600 dark:text-amber-400' : undefined} href={ap('/admin/orders?status=out_for_delivery', host)} />
        </div>
      </SectionCard>

      <SectionCard>
        <SectionHeader title="Order Quality" actionLabel={canReturns ? 'Returns' : undefined} href={canReturns ? ap('/admin/returns', host) : undefined} />
        <div className="grid grid-cols-2 gap-2">
          <CompactStat label="Cancellation rate" value={pctStr(f.cancelRate)} sub={`Prev ${pctStr(f.cancelRatePrev)}`} pct={delta(f.cancelRate, f.cancelRatePrev)} invert href={ap('/admin/orders?status=cancelled', host)} />
          <CompactStat label="Return rate" value={pctStr(f.returnRate)} sub={`${numStr(f.returnsInRange)} requests in range`} href={canReturns ? ap('/admin/returns', host) : undefined} />
          <CompactStat label="Guest checkouts" value={pctStr(f.guestShare, 0)} sub="of orders in range" />
          <CompactStat label="Cancel requests" value={numStr(a.cancelRequested)} sub="awaiting decision" tone={a.cancelRequested ? 'text-amber-600 dark:text-amber-400' : undefined} href={ap('/admin/orders?status=cancel_requested', host)} />
        </div>
        <div className="mt-3 pt-3 border-t border-border-default space-y-0.5">
          {canReturns && <MiniStat label="Open return requests" value={numStr(a.openReturns)} tone={a.openReturns ? 'text-amber-600 dark:text-amber-400' : undefined} href={ap('/admin/returns', host)} />}
          <MiniStat label="RTO in transit" value={numStr(data.returns.rtoInTransit)} tone={data.returns.rtoInTransit ? 'text-orange-600 dark:text-orange-400' : undefined} href={canReturns ? ap('/admin/returns', host) : undefined} />
          <MiniStat label="Unpaid online orders" value={numStr(a.unpaidOnline)} sub={a.unpaidOnline ? `Rs ${Math.round(a.unpaidOnlineAmount).toLocaleString('en-IN')} awaiting payment` : undefined} tone={a.unpaidOnline ? 'text-red-500 dark:text-red-400' : undefined} href={ap('/admin/orders', host)} />
        </div>
      </SectionCard>

      <SectionCard>
        <SectionHeader title="Service & Reviews" actionLabel={canReviews ? 'Reviews' : undefined} href={canReviews ? ap('/admin/reviews', host) : undefined} />
        <div className="space-y-0.5">
          <MiniStat label="Open support chats" value={numStr(a.supportOpen)} tone={a.supportOpen ? 'text-amber-600 dark:text-amber-400' : undefined} href={canCrm ? ap('/admin/crm', host) : undefined} />
          <MiniStat label="Chats in range" value={numStr(e.supportInRange)} sub={e.supportResolutionHours != null ? `avg ${hoursStr(e.supportResolutionHours)} to close` : undefined} />
          <MiniStat label="New reviews" value={numStr(e.newReviews)} sub={e.avgRating != null ? `avg ${e.avgRating} of 5 in range` : undefined} href={canReviews ? ap('/admin/reviews', host) : undefined} />
          <MiniStat label="Store rating" value={e.avgRatingAll != null ? `${e.avgRatingAll} / 5` : 'n/a'} sub="all approved reviews" />
          <MiniStat label="Low ratings (2 or less)" value={numStr(e.lowRatingReviews)} tone={e.lowRatingReviews ? 'text-red-500 dark:text-red-400' : undefined} href={canReviews ? ap('/admin/reviews', host) : undefined} />
          {canReviews && <MiniStat label="Awaiting approval" value={numStr(a.pendingReviews)} tone={a.pendingReviews ? 'text-amber-600 dark:text-amber-400' : undefined} href={ap('/admin/reviews', host)} />}
          {canTasks && <MiniStat label="Open tasks" value={numStr(a.openTasks)} sub={a.overdueTasks ? `${numStr(a.overdueTasks)} overdue` : undefined} tone={a.overdueTasks ? 'text-red-500 dark:text-red-400' : undefined} href={ap('/admin/tasks', host)} />}
        </div>
      </SectionCard>
    </div>
  )
}
