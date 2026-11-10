import { BackLoading, CampaignEditLoading } from '../CampaignLoading'

export default function Loading() {
  return (
    <div className="space-y-5 p-4 sm:p-6" role="status" aria-label="Loading campaign">
      <BackLoading />
      <CampaignEditLoading />
    </div>
  )
}
