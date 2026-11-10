import { LoadingKpis, LoadingSection, LoadingTabs, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import { LABELS_KPIS } from './_components/overview-kpis'

export default function Loading() {
  return (
    <PageLoading title="Label Generator" description="Generate and download product labels with barcodes and QR codes">
      <div className="space-y-5">
        <LoadingTabs tabs={['Overview', 'Label generator']} />
        <div className="space-y-4">
          <Sk className="h-control w-full max-w-2xl rounded-lg" />
          <LoadingKpis labels={LABELS_KPIS} />
          <LoadingSection title="Needs attention" lines={3} />
        </div>
      </div>
    </PageLoading>
  )
}
