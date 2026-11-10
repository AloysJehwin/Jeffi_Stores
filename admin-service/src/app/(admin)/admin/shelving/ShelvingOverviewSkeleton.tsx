import { LoadingKpis, LoadingSection } from '@/components/admin/kit/skeleton'

/** The Shelving overview body while its data loads. */
export default function ShelvingOverviewSkeleton() {
  return (
    <>
      <LoadingKpis labels={['Locations', 'Utilisation', 'Products shelved', 'Unshelved products', 'Shelf movements', 'Units moved']} />
      <LoadingSection title="Needs attention" lines={3} />
    </>
  )
}
