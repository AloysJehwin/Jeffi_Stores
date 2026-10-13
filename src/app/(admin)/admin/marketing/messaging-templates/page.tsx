import { Suspense } from 'react'
import MessagingTemplatesClient from './MessagingTemplatesClient'
import AdminSkeleton from '@/components/admin/AdminSkeleton'

export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    <Suspense fallback={<AdminSkeleton variant="list" showStats={false} />}>
      <MessagingTemplatesClient />
    </Suspense>
  )
}
