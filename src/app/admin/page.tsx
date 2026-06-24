import { redirect } from 'next/navigation'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'

export default async function AdminPage() {
  const host = await getHost()
  redirect(ap('/admin/dashboard', host))
}
