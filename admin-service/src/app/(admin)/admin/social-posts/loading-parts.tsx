import { LoadingKpis, LoadingSection, LoadingTable, Sk } from '@/components/admin/kit/skeleton'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Stacked post or comment cards while a tab's list loads. */
export function CardsLoading({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <Sk key={i} className="h-20 w-full rounded-lg" />
      ))}
    </div>
  )
}

/** The month grid with its weekday headings while the month's posts load. */
export function CalendarGridLoading() {
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[700px] grid-cols-7 border-l border-t border-border-default">
        {WEEKDAYS.map(w => (
          <div key={w} className="border-b border-r border-border-default bg-surface-secondary px-2 py-1 text-xs text-foreground-muted">
            {w}
          </div>
        ))}
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} className="min-h-[92px] border-b border-r border-border-default p-1">
            <Sk className="h-3 w-4" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** The Insights tab body while its metrics load. */
export function InsightsLoading() {
  return (
    <>
      <LoadingKpis labels={['Posts', 'Impressions', 'Reach', 'Engagement', 'Clicks', 'Revenue']} />
      <LoadingSection title="By network">
        <LoadingTable columns={['Network', 'Posts', 'Impressions', 'Reach', 'Engagement', 'Clicks']} rows={4} bare />
      </LoadingSection>
      <LoadingSection title="Top posts">
        <LoadingTable columns={['Post', 'Impressions', 'Engagement', 'Clicks', 'Orders', 'Revenue']} rows={5} bare />
      </LoadingSection>
    </>
  )
}
