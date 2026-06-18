import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { ap } from '@/lib/admin-path'
import CashSaleDetailClient from './CashSaleDetailClient'

export const dynamic = 'force-dynamic'

export default async function CashSaleDetailPage({ params }: { params: { id: string } }) {
  const host = (await headers()).get('host') ?? ''
  const cookieStore = await cookies()
  const token = cookieStore.get('admin_token')
  if (!token) redirect(ap('/admin/login', host))

  let session: any = null
  try { session = await verifyToken(token.value) } catch { redirect(ap('/admin/login', host)) }

  if (!hasScope(session?.role || '', session?.scopes || [], 'invoices')) {
    redirect(ap('/admin/dashboard', host))
  }

  return <CashSaleDetailClient id={params.id} />
}
