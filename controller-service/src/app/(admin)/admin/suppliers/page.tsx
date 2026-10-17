import { Suspense } from 'react'
import { PageBody, PageHeader } from '@/components/admin/kit/layout'
import SuppliersClient from './_components/SuppliersClient'

export const dynamic = 'force-dynamic'

export default function SuppliersPage() {
  return (
    <PageBody>
      <PageHeader title="Suppliers" description="Purchasing, deliveries and what you owe suppliers" />
      <Suspense fallback={null}>
        <SuppliersClient />
      </Suspense>
    </PageBody>
  )
}
