import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { ap } from '@/lib/admin-path'

export default async function AdminPage() {
  const host = (await headers()).get('host') ?? ''
  redirect(ap('/admin/dashboard', host))
}
