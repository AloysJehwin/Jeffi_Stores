import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

export default async function AdminPage() {
  const host = await getHost()
  redirect(ap('/admin/dashboard', host))
}
