import { Suspense } from 'react'
import SuppliersClient from './_components/SuppliersClient'

export const dynamic = 'force-dynamic'

export default function SuppliersPage() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Suppliers</h1>
        <p className="text-foreground-secondary mt-1 text-sm">Purchasing, deliveries and what you owe suppliers</p>
      </div>
      <Suspense fallback={null}>
        <SuppliersClient />
      </Suspense>
    </div>
  )
}
