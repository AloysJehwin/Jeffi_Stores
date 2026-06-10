import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/jwt'
import SupplierDetailClient from './SupplierDetailClient'
import { ap } from '@/lib/admin-path'

export const dynamic = 'force-dynamic'

export default async function SupplierDetailPage({ params }: { params: { id: string } }) {
  const host = (await headers()).get('host') ?? ''
  const cookieStore = cookies()
  const token = cookieStore.get('admin_token')
  if (!token) redirect(ap('/admin/login', host))

  try { await verifyToken(token.value) } catch { redirect(ap('/admin/login', host)) }

  return <SupplierDetailClient id={params.id} />
}
