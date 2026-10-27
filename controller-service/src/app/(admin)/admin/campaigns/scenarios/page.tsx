import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

// Scenarios are a tab on the campaigns page.
export default async function ScenariosPage() {
  redirect(ap('/admin/campaigns?tab=scenarios', await getHost()))
}
