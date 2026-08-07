export const dynamic = 'force-dynamic'

import { cookies} from 'next/headers'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { redirect } from 'next/navigation'
import BusinessCustomerDetailClient from './BusinessCustomerDetailClient'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'

export default async function BusinessCustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cookieStore = await cookies()
  const token = cookieStore.get('admin_sid')
  const host = await getHost()
  if (!token) redirect(ap('/admin/login', host))
  const session = await verifyToken(token.value).catch(() => null)
  if (!session || !hasScope(session.role, session.scopes || [], 'business_customers:read')) redirect(ap('/admin/dashboard', host))

  return <BusinessCustomerDetailClient id={id} />
}
