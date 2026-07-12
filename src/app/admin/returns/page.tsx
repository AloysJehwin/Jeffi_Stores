import AdminReturnsClient from './AdminReturnsClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function AdminReturnsPage() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Returns</h1>
        <p className="text-foreground-secondary mt-1 text-sm">Active return requests — review, track, and valuate returned items</p>
      </div>
      <AdminReturnsClient />
    </div>
  )
}
