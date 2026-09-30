import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

export default async function AdminReplicationPage() {
  const host = await getHost()
  redirect(ap('/admin/audit?tab=replication', host))
}
