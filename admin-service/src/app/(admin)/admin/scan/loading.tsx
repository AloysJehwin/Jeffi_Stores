import { LoadingTabs, PageLoading, Sk } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading title="QuickScan" description="Scan a packing slip QR to update orders, or a product label QR to view product details">
      <LoadingTabs tabs={['Scanner', 'Overview']} />
      <div className="flex flex-col items-center justify-center gap-6 p-8">
        <Sk className="w-20 h-20 rounded-2xl" />
        <span className="w-full max-w-xs py-4 bg-secondary-500/60 text-white text-center font-semibold rounded-2xl text-lg">Start Scanning</span>
        <span className="text-sm text-foreground-muted">Enter order number manually</span>
      </div>
    </PageLoading>
  )
}
