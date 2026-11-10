import { LoadingKpis, LoadingSection, LoadingTabs, LoadingToolbar, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import { PACKING_KPIS } from './_components/overview-kpis'

export default function Loading() {
  return (
    <PageLoading title="Packing Slips" description="Packing slips, shipping labels and invoices for each order">
      <LoadingTabs tabs={['Overview', 'Packing slips']} />
      <div className="space-y-4">
        <Sk className="h-control w-full max-w-2xl rounded-lg" />
        <LoadingToolbar filters={2} />
        <LoadingKpis labels={PACKING_KPIS} />
        <LoadingSection title="Needs attention" lines={3} />
      </div>
    </PageLoading>
  )
}
