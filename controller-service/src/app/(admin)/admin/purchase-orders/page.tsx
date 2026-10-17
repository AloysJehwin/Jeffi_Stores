import { Suspense } from 'react'
import { PageBody, PageHeader } from '@/components/admin/kit/layout'
import PurchaseOrdersClient from './_components/PurchaseOrdersClient'

export const dynamic = 'force-dynamic'

export default function PurchaseOrdersPage() {
  return (
    <PageBody>
      <PageHeader title="Purchase Orders" description="Raise, track and receive purchase orders" />
      <Suspense fallback={null}>
        <PurchaseOrdersClient />
      </Suspense>
    </PageBody>
  )
}
