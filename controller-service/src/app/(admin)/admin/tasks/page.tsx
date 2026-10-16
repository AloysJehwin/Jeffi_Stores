import { Suspense } from 'react'
import AdminTasksClient from './AdminTasksClient'
import TasksTabs from './TasksTabs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function AdminTasksPage() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Tasks</h1>
        <p className="text-foreground-secondary mt-1 text-sm">Customer follow-ups assigned to you and the team</p>
      </div>
      <Suspense fallback={null}>
        <TasksTabs>
          <AdminTasksClient />
        </TasksTabs>
      </Suspense>
    </div>
  )
}
