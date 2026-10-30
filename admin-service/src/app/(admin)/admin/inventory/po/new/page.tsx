import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

// Moved to /admin/purchase-orders/new; keep old links and drafts working.
export default async function LegacyNewPORedirect({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const qs = new URLSearchParams(await searchParams).toString()
  redirect(ap(`/admin/purchase-orders/new${qs ? `?${qs}` : ''}`, await getHost()))
}
