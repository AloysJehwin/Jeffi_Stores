import { Suspense } from 'react'
import PurchaseOrdersClient from './_components/PurchaseOrdersClient'

export const dynamic = 'force-dynamic'

export default function PurchaseOrdersPage() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Purchase Orders</h1>
        <p className="text-foreground-secondary mt-1 text-sm">Raise, track and receive purchase orders</p>
      </div>
      <Suspense fallback={null}>
        <PurchaseOrdersClient />
      </Suspense>
    </div>
  )
}
