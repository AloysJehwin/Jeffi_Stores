export const dynamic = 'force-dynamic'

import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { redirect } from 'next/navigation'
import RFQDetailClient from './RFQDetailClient'

export default async function BusinessRFQDetailPage({ params }: { params: { id: string } }) {
  const cookieStore = cookies()
  const token = cookieStore.get('admin_token')
  if (!token) redirect('/admin/login')
  const session = await verifyToken(token.value).catch(() => null)
  if (!session || !hasScope(session.role, session.scopes || [], 'business_rfqs')) redirect('/admin/dashboard')

  return <RFQDetailClient id={params.id} />
}
