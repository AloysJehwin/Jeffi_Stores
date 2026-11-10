import { LoadingTabs, PageLoading } from '@/components/admin/kit/skeleton'
import { PricingLoading } from './PricingLoading'

export default function Loading() {
  return (
    <PageLoading title="Configuration" description="Server pricing and margins, and which providers send messages and serve AI for every store.">
      <LoadingTabs tabs={['Server pricing', 'Providers']} active={0} />
      <PricingLoading />
    </PageLoading>
  )
}
