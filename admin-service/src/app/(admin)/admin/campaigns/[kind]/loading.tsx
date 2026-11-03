import { CampaignDetailSkeleton, CampaignPageSkeleton } from '@/components/admin/campaigns/CampaignSkeletons'

export default function Loading() {
  return (
    <CampaignPageSkeleton>
      <CampaignDetailSkeleton />
    </CampaignPageSkeleton>
  )
}
