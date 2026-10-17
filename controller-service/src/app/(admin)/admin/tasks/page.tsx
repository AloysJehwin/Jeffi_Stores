import { Suspense } from 'react'
import AdminTasksClient from './AdminTasksClient'
import TasksTabs from './TasksTabs'
import { PageBody, PageHeader } from '@/components/admin/kit/layout'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function AdminTasksPage() {
  return (
    <PageBody>
      <PageHeader title="Tasks" description="Customer follow-ups assigned to you and the team" />
      <Suspense fallback={null}>
        <TasksTabs>
          <AdminTasksClient />
        </TasksTabs>
      </Suspense>
    </PageBody>
  )
}
