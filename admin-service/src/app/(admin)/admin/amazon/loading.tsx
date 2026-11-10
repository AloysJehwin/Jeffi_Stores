import { LoadingTabs, PageLoading } from '@/components/admin/kit/skeleton'
import { AMAZON_TAB_LABELS, AmazonTabLoading } from './_components/skeletons'

export default function Loading() {
  return (
    <PageLoading title="Amazon" description="Listing health, Buy Box, fees and margin, and repricing for your Amazon.in listings" actions={1}>
      <div className="space-y-4">
        <LoadingTabs tabs={AMAZON_TAB_LABELS} />
        <AmazonTabLoading tab="overview" />
      </div>
    </PageLoading>
  )
}
