import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

// This program now lives under Marketing > Customer Programs.
export default async function ReferralsRedirectPage() {
  redirect(`${ap('/admin/customer-programs', await getHost())}?tab=referrals`)
}
