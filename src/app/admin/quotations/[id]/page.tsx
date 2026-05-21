import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import QuotationDetailClient from './QuotationDetailClient'

export const dynamic = 'force-dynamic'

export default async function QuotationDetailPage({ params }: { params: { id: string } }) {
  const cookieStore = cookies()
  const token = cookieStore.get('admin_token')
  if (!token) redirect('/admin/login')

  let session: any = null
  try { session = await verifyToken(token.value) } catch { redirect('/admin/login') }

  if (!hasScope(session?.role || '', session?.scopes || [], 'quotations')) {
    redirect('/admin/dashboard')
  }

  return <QuotationDetailClient id={params.id} />
}
