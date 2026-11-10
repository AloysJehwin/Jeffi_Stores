import { Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/admin/kit/layout'
import { LoadingTabBar, LoadingPeriodBar } from '../products/_components/loading-parts'
import EnrichmentOverviewSkeleton from './EnrichmentOverviewSkeleton'

export default function Loading() {
  return (
    <div className="space-y-5 p-4 sm:p-6" role="status" aria-busy="true" aria-label="Loading Catalog Enrichment">
      <PageHeader
        media={<Sparkles className="w-5 h-5 text-accent-500" />}
        title="Catalog Enrichment"
        description="AI-generated product intelligence for admin review"
      />
      <div className="mb-6">
        <LoadingTabBar tabs={['Overview', 'Suggestions']} />
      </div>
      <div className="space-y-4">
        <LoadingPeriodBar />
        <EnrichmentOverviewSkeleton />
      </div>
    </div>
  )
}
