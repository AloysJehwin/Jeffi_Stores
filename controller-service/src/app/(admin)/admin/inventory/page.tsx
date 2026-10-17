import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { legacyInventoryRedirect } from '@/lib/purchasing/legacy-urls'
import { PageBody, PageHeader } from '@/components/admin/kit/layout'
import InventoryClient from './InventoryClient'

export const dynamic = 'force-dynamic'

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const to = legacyInventoryRedirect(await searchParams)
  if (to) redirect(ap(to, await getHost()))
  return (
    <PageBody>
      <PageHeader title="Inventory" description="Stock levels, movements and valuation" />
      <InventoryClient />
    </PageBody>
  )
}
