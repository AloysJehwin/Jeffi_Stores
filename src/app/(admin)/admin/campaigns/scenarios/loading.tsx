import { CampaignCardListSkeleton, CampaignPageSkeleton } from '@/components/admin/campaigns/CampaignSkeletons'

export default function Loading() {
  return (
    <CampaignPageSkeleton title>
      <CampaignCardListSkeleton />
    </CampaignPageSkeleton>
  )
}
