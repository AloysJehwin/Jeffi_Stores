import { Suspense } from 'react'
import ReturnsTabs from './_components/ReturnsTabs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function AdminReturnsPage() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Returns</h1>
        <p className="text-foreground-secondary mt-1 text-sm">
          Return rate, reasons and refunds, and the active requests to review, track and valuate
        </p>
      </div>
      <Suspense fallback={null}>
        <ReturnsTabs />
      </Suspense>
    </div>
  )
}
