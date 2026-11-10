import { AI_CAPABILITY_LABEL } from '@/lib/ai/feature-labels'
import { LoadingTable, LoadingTabs, PageLoading } from '@/components/admin/kit/skeleton'
import { AI_PRICE_COLUMNS } from './columns'

const CAPS = ['text', 'embed', 'vision', 'image', 'video']

export default function Loading() {
  return (
    <PageLoading
      title="AI Pricing"
      description="Per-unit cost and the price stores are charged to their wallet. The flagship is never charged. Changes apply within 5 minutes."
    >
      <div className="space-y-4">
        <LoadingTabs tabs={['All', ...CAPS.map(c => AI_CAPABILITY_LABEL[c] ?? c)]} active={0} />
        <LoadingTable columns={AI_PRICE_COLUMNS} rows={6} />
      </div>
    </PageLoading>
  )
}
