import { LoadingSection, Sk } from '@/components/admin/kit/skeleton'
import { LoadingOverviewBody } from '../products/_components/loading-parts'

const KPIS = ['Products enriched', 'Pending approval', 'Approval rate', 'Failed', 'Catalogue coverage', 'Fields filled']
const FIELDS = ['Description', 'Use cases', 'Keywords', 'Who uses it', 'Application', 'Product type', 'Features', 'Search tags']

/** Overview body while it loads: real KPI labels and the AI-fields panel with its field names. Server-safe. */
export default function EnrichmentOverviewSkeleton() {
  return (
    <LoadingOverviewBody
      kpis={KPIS}
      panel={
        <LoadingSection title="AI fields on active products">
          <div className="space-y-2">
            {FIELDS.map(f => (
              <div key={f} className="flex items-center gap-3 text-xs">
                <span className="w-28 shrink-0 text-foreground-secondary">{f}</span>
                <Sk className="h-2 flex-1 rounded-full" />
                <Sk className="h-3 w-10" />
              </div>
            ))}
          </div>
        </LoadingSection>
      }
    />
  )
}
