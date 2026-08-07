import { cookies} from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/jwt'
import SupplierDetailClient from './SupplierDetailClient'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'

export const dynamic = 'force-dynamic'

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const host = await getHost()
  const cookieStore = await cookies()
  const token = cookieStore.get('admin_sid')
  if (!token) redirect(ap('/admin/login', host))

  try { await verifyToken(token.value) } catch { redirect(ap('/admin/login', host)) }

  return <SupplierDetailClient id={id} />
}
