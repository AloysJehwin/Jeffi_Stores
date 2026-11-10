import { LoadingTabs, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import { GOOGLE_ADS_TAB_LABELS, GoogleAdsRangeLoading, GoogleAdsTabLoading } from './_components/skeletons'

// The account line under the title is data, so it shimmers.
export default function Loading() {
  return (
    <PageLoading title="Google Ads" description={<Sk className="mt-1 h-3.5 w-72 max-w-full" />} actions={1}>
      <LoadingTabs tabs={GOOGLE_ADS_TAB_LABELS} />
      <GoogleAdsRangeLoading />
      <GoogleAdsTabLoading tab="overview" />
    </PageLoading>
  )
}
