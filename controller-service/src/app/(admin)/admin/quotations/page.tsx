import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import QuotationsTabs from './QuotationsTabs'
import { adminCookieName } from '@/lib/auth/admin-cookie'
import { getStoreIdentity } from '@/lib/catalog/site-controls'

export async function generateMetadata() {
  const { name } = await getStoreIdentity()
  return { title: `Quotations — ${name} Admin` }
}

export default async function QuotationsPage() {
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

  if (!hasScope(session?.role || '', session?.scopes || [], 'quotations:read')) {
    redirect(ap('/admin/dashboard', host))
  }

  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  const canWrite = hasScope(role, scopes, 'quotations:write')

  return (
    <div className="p-4 sm:p-6">
      <QuotationsTabs canWrite={canWrite} />
    </div>
  )
}
