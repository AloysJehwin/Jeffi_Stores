export const dynamic = 'force-dynamic'

import { cookies, headers } from 'next/headers'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { redirect } from 'next/navigation'
import RFQDetailClient from './RFQDetailClient'
import { ap } from '@/lib/admin-path'

export default async function BusinessRFQDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cookieStore = await cookies()
  const token = cookieStore.get('admin_token')
  const host = (await headers()).get('host') ?? ''
  if (!token) redirect(ap('/admin/login', host))
  const session = await verifyToken(token.value).catch(() => null)
  if (!session || !hasScope(session.role, session.scopes || [], 'business_rfqs')) redirect(ap('/admin/dashboard', host))

  return <RFQDetailClient id={id} />
}
