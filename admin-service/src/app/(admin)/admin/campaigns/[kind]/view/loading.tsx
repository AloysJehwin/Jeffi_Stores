import { ChevronLeft } from 'lucide-react'
import { CampaignViewLoading } from '../CampaignLoading'

export default function Loading() {
  return (
    <div className="space-y-5 p-4 sm:p-6" role="status" aria-label="Loading campaign">
      <span className="inline-flex items-center gap-1 text-xs text-foreground-muted">
        <ChevronLeft className="h-3.5 w-3.5" />
        Campaigns
      </span>
      <CampaignViewLoading />
    </div>
  )
}
