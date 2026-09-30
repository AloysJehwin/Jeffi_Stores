import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import InvoiceDetailClient from './InvoiceDetailClient'
import { adminCookieName } from '@/lib/auth/admin-cookie'

export const dynamic = 'force-dynamic'

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cookieStore = await cookies()
  const token = cookieStore.get(await adminCookieName())
  const host = await getHost()
  if (!token) redirect(ap('/admin/login', host))

  let session: any = null
  try {
    session = await verifyToken(token.value)
  } catch {
    redirect(ap('/admin/login', host))
  }

  if (!hasScope(session?.role || '', session?.scopes || [], 'invoices:read')) {
    redirect(ap('/admin/dashboard', host))
  }

  return <InvoiceDetailClient id={id} />
}
