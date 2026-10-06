import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

// This program now lives on the CRM page.
export default async function LoyaltyRedirectPage() {
  redirect(`${ap('/admin/crm', await getHost())}#loyalty`)
}
