import { LoadingChart, LoadingKpis, LoadingSection } from '@/components/admin/kit/skeleton'
import { SplitRow } from '@/components/admin/kit'

/** The Reviews overview body while its data loads. */
export default function ReviewsOverviewSkeleton() {
  return (
    <>
      <LoadingKpis labels={['New reviews', 'Average rating', '4-5 star', '1-2 star', 'With photos', 'Pending moderation']} />
      <LoadingSection title="Needs attention" lines={3} />
      <SplitRow
        scroll="narrow"
        wide={
          <LoadingChart title="Reviews per day" />
        }
        narrow={
          <LoadingSection title="Rating distribution" lines={5} />
        }
      />
      <LoadingChart title="Average rating trend" height="h-44" />
      <LoadingSection title="Review requests" lines={3} />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        <LoadingSection title="Top rated products" lines={5} />
        <LoadingSection title="Lowest rated products" lines={5} />
        <LoadingSection title="Most new 1-2 star reviews" lines={5} />
      </div>
    </>
  )
}
