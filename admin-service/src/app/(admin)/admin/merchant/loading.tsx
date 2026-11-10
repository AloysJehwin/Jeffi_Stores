import { LoadingTabs, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import { RangeLoading } from '@/components/admin/channels/skeletons'
import { MERCHANT_TAB_LABELS, MerchantTabLoading } from './_components/skeletons'

export default function Loading() {
  return (
    <PageLoading
      title="Google Merchant Center"
      description={
        <span className="inline-flex items-center gap-1.5">
          Account <Sk className="h-3.5 w-28" />
        </span>
      }
      actions={1}
    >
      <div className="space-y-4">
        <LoadingTabs tabs={MERCHANT_TAB_LABELS} />
        <RangeLoading />
        <MerchantTabLoading tab="overview" />
      </div>
    </PageLoading>
  )
}
