export const dynamic = 'force-dynamic'

import { cookies, headers } from 'next/headers'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { redirect } from 'next/navigation'
import BusinessCustomerDetailClient from './BusinessCustomerDetailClient'
import { ap } from '@/lib/admin-path'

export default async function BusinessCustomerDetailPage({ params }: { params: { id: string } }) {
  const cookieStore = cookies()
  const token = cookieStore.get('admin_token')
  const host = (await headers()).get('host') ?? ''
  if (!token) redirect(ap('/admin/login', host))
  const session = await verifyToken(token.value).catch(() => null)
  if (!session || !hasScope(session.role, session.scopes || [], 'business_customers')) redirect(ap('/admin/dashboard', host))

  return <BusinessCustomerDetailClient id={params.id} />
}
