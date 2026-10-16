import { Suspense } from 'react'
import ReplacementsTabs from './_components/ReplacementsTabs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function AdminReplacementsPage() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Replacements</h1>
        <p className="text-foreground-secondary mt-1 text-sm">
          Replacement rate, reasons and time to close, and the replacement orders created from approved return requests
        </p>
      </div>
      <Suspense fallback={null}>
        <ReplacementsTabs />
      </Suspense>
    </div>
  )
}
