'use client'

import Link from 'next/link'
import { ap } from '@/lib/admin-path'
import { CompactStat, numStr, hoursStr, Chip } from '@/components/admin/dashboard/Primitives'
import type { Service, LowReview } from '@/lib/crm-insights-shared'

function agoStr(iso: string | null): string {
  if (!iso) return ''
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (!Number.isFinite(d) || d < 0) return ''
  return d === 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`
}

export default function ServiceCard({ service, lowReviews }: { service: Service; lowReviews: LowReview[] }) {
  const empty = service.opened === 0 && service.closed === 0 && service.reviews === 0
    && service.unansweredChats === 0 && service.unansweredInbound === 0 && lowReviews.length === 0
  if (empty) return null

  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
      <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">Service and Support</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <CompactStat label="Chats opened" value={numStr(service.opened)} />
        <CompactStat label="Chats closed" value={numStr(service.closed)} />
        <CompactStat label="Median first reply" value={hoursStr(service.medianFirstResponseMin == null ? null : service.medianFirstResponseMin / 60)} />
        <CompactStat label="Median resolution" value={hoursStr(service.medianResolutionMin == null ? null : service.medianResolutionMin / 60)} />
        <CompactStat label="Unanswered chats" value={numStr(service.unansweredChats)} tone={service.unansweredChats > 0 ? 'text-amber-600 dark:text-amber-400' : undefined} />
        <CompactStat label="Unanswered inbound" value={numStr(service.unansweredInbound)} tone={service.unansweredInbound > 0 ? 'text-amber-600 dark:text-amber-400' : undefined} />
        <CompactStat label="Reviews" value={numStr(service.reviews)} sub={service.avgRating == null ? undefined : `avg ${service.avgRating.toFixed(1)}`} />
        <CompactStat label="Paid orders" value={numStr(service.paidOrders)} />
      </div>

      {lowReviews.length > 0 && (
        <>
          <p className="text-[11px] uppercase tracking-wide text-foreground-muted font-medium mb-2">Recent low reviews</p>
          <div className="divide-y divide-border-default">
            {lowReviews.map(lr => (
              <Link
                key={lr.id}
                href={ap(lr.userId ? `/admin/customers/${lr.userId}` : '/admin/reviews?filter=all')}
                className="flex items-center gap-3 py-2 group hover:bg-surface-secondary/50 -mx-2 px-2 rounded-lg transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground truncate group-hover:text-accent-600 transition-colors">{lr.productName || 'A product'}</p>
                  <p className="text-[11px] text-foreground-muted truncate mt-0.5">{lr.name}, {agoStr(lr.createdAt)}</p>
                </div>
                <Chip tone="bad">{lr.rating} star</Chip>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
