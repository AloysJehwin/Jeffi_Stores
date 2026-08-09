import { cookies} from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import CashSaleDetailClient from './CashSaleDetailClient'

export const dynamic = 'force-dynamic'

export default async function CashSaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const host = await getHost()
  const cookieStore = await cookies()
  const token = cookieStore.get('admin_sid')
  if (!token) redirect(ap('/admin/login', host))

  let session: any = null
  try { session = await verifyToken(token.value) } catch { redirect(ap('/admin/login', host)) }

  if (!hasScope(session?.role || '', session?.scopes || [], 'invoices:read')) {
    redirect(ap('/admin/dashboard', host))
  }

  return <CashSaleDetailClient id={id} />
}
