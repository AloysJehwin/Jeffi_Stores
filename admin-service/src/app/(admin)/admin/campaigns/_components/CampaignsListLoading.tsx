import { Sk } from '@/components/admin/kit/skeleton'
import { CampaignCardListSkeleton } from '@/components/admin/campaigns/CampaignSkeletons'

/** The Campaigns tab (search, status filter, campaign cards) before its first rows arrive. */
export default function CampaignsListLoading() {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Sk className="h-control min-w-0 flex-1 rounded-lg" />
        <div className="flex h-control w-fit items-center gap-1 rounded-lg border border-border-default bg-surface-elevated p-0.5">
          {['all', 'active', 'paused'].map((s, i) => (
            <span key={s} className={`flex h-full items-center rounded-md px-3 text-xs font-semibold capitalize ${i === 0 ? 'bg-accent-500 text-white' : 'text-foreground-muted'}`}>
              {s}
            </span>
          ))}
        </div>
      </div>
      <CampaignCardListSkeleton />
    </div>
  )
}
