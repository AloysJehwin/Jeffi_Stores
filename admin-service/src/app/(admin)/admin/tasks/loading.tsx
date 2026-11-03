import { ListSkeleton } from '@/components/admin/kit/states'

export default function Loading() {
  return (
    <div className="p-4 sm:p-6">
      <ListSkeleton kpis={0} />
    </div>
  )
}
