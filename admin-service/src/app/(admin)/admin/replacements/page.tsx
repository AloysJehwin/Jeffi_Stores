import { Suspense } from 'react'
import { PageBody, PageHeader } from '@/components/admin/kit'
import ReplacementsTabs from './_components/ReplacementsTabs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function AdminReplacementsPage() {
  return (
    <PageBody>
      <PageHeader title="Replacements" description="Replacement rate, reasons and time to close, and the replacement orders created from approved return requests" />
      <Suspense fallback={null}>
        <ReplacementsTabs />
      </Suspense>
    </PageBody>
  )
}
