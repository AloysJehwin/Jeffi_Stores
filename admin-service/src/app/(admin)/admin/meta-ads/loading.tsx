import { PageLoading } from '@/components/admin/kit/skeleton'
import { MetaAdsBodyLoading } from './_components/skeletons'

export default function Loading() {
  return (
    <PageLoading title="Meta Ads" description="Facebook and Instagram ads: spend, purchases, true ROAS from your orders, and the Conversions API" actions={1}>
      <MetaAdsBodyLoading />
    </PageLoading>
  )
}
