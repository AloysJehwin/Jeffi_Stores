import { LoadingKpis, LoadingSection } from '@/components/admin/kit/skeleton'

/** The Replacements overview body while its data loads. */
export default function ReplacementsOverviewSkeleton() {
  return (
    <>
      <LoadingKpis labels={['Requests', 'Replacement rate', 'Open now', 'Closed', 'Time to close']} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <LoadingSection title="Needs attention" lines={3} />
        <LoadingSection title="By reason" lines={4} />
      </div>
    </>
  )
}
