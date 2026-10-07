import { ScenarioDetailSkeleton } from '@/components/admin/campaigns/CampaignSkeletons'

export default function Loading() {
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <ScenarioDetailSkeleton />
    </div>
  )
}
