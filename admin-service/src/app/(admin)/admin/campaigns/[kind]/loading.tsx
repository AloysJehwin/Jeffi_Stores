import { BackLoading } from './CampaignLoading'

// Shared by the redirect and every page below it (view, edit): the back link they all start with.
export default function Loading() {
  return (
    <div className="p-4 sm:p-6" role="status" aria-label="Loading campaign">
      <BackLoading />
    </div>
  )
}
