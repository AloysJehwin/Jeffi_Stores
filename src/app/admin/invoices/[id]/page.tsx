import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import InvoiceDetailClient from './InvoiceDetailClient'

export const dynamic = 'force-dynamic'

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const cookieStore = cookies()
  const token = cookieStore.get('admin_token')
  if (!token) redirect('/admin/login')

  let session: any = null
  try { session = await verifyToken(token.value) } catch { redirect('/admin/login') }

  if (!hasScope(session?.role || '', session?.scopes || [], 'invoices')) {
    redirect('/admin/dashboard')
  }

  return <InvoiceDetailClient id={params.id} />
}
