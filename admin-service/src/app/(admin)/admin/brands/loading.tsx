import { ListSkeleton } from '@/components/admin/kit'

export default function Loading() {
  return (
    <div className="p-4 sm:p-6">
      <ListSkeleton kpis={3} />
    </div>
  )
}
