import { PageLoading } from '@/components/admin/kit/skeleton'
import { AmazonAdsBodyLoading } from './_components/skeletons'

export default function Loading() {
  return (
    <PageLoading title="Amazon Ads" description="Sponsored Products: spend, ACoS and TACoS, campaigns, keywords, search terms and products" actions={1}>
      <AmazonAdsBodyLoading />
    </PageLoading>
  )
}
