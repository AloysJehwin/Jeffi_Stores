import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

// Merchant Sync was split into the Google Merchant and Amazon consoles. Old links (and any
// ?connected=... return from an older sign-in) land on Google Merchant.
export default async function MerchantSyncRedirect({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const qs = new URLSearchParams(await searchParams).toString()
  redirect(ap(`/admin/merchant${qs ? `?${qs}` : ''}`, await getHost()))
}
