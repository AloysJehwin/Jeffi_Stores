import { cookies} from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import InvoiceDetailClient from './InvoiceDetailClient'

export const dynamic = 'force-dynamic'

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cookieStore = await cookies()
  const token = cookieStore.get('admin_token')
  const host = await getHost()
  if (!token) redirect(ap('/admin/login', host))

  let session: any = null
  try { session = await verifyToken(token.value) } catch { redirect(ap('/admin/login', host)) }

  if (!hasScope(session?.role || '', session?.scopes || [], 'invoices:read')) {
    redirect(ap('/admin/dashboard', host))
  }

  return <InvoiceDetailClient id={id} />
}
