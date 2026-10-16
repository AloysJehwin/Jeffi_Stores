import { FormSkeleton } from '@/components/admin/kit'

export default function Loading() {
  return (
    <div className="p-4 sm:p-6">
      <FormSkeleton sections={2} />
    </div>
  )
}
