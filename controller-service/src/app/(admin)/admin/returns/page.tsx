import { Suspense } from 'react'
import { PageBody, PageHeader } from '@/components/admin/kit'
import ReturnsTabs from './_components/ReturnsTabs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function AdminReturnsPage() {
  return (
    <PageBody>
      <PageHeader title="Returns" description="Return rate, reasons and refunds, and the active requests to review, track and valuate" />
      <Suspense fallback={null}>
        <ReturnsTabs />
      </Suspense>
    </PageBody>
  )
}
