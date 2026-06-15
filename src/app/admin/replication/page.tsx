import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { ap } from '@/lib/admin-path'

export default async function AdminReplicationPage() {
  const host = headers().get('host') || ''
  redirect(ap('/admin/audit?tab=replication', host))
}
