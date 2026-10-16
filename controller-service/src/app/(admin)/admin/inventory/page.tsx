import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { legacyInventoryRedirect } from '@/lib/purchasing/legacy-urls'
import InventoryClient from './InventoryClient'

export const dynamic = 'force-dynamic'

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const to = legacyInventoryRedirect(await searchParams)
  if (to) redirect(ap(to, await getHost()))
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Inventory</h1>
        <p className="text-foreground-secondary mt-1">Stock levels, movements and valuation</p>
      </div>
      <InventoryClient />
    </div>
  )
}
