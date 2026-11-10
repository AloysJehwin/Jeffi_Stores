import { LoadingTabs, PageLoading } from '@/components/admin/kit/skeleton'
import { LoadingPeriodBar } from '../products/_components/loading-parts'
import { OffersOverviewLoading } from './OffersLoading'

export default function Loading() {
  return (
    <PageLoading
      title="Offers"
      description="Razorpay bank offers shown on product pages, and your own product offers with their titles, dates, images, and assigned products."
    >
      <LoadingTabs tabs={['Overview', 'Bank Offers', 'Offers', 'Drafts']} />
      <div className="space-y-4">
        <LoadingPeriodBar />
        <OffersOverviewLoading />
      </div>
    </PageLoading>
  )
}
