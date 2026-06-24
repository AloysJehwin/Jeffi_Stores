import { cookies} from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import QuotationsClient from './QuotationsClient'

export const metadata = {
  title: 'Quotations — Jeffi Admin' }

export default async function QuotationsPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get('admin_token')
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

  return (
    <div className="p-4 sm:p-6">
      <QuotationsClient />
    </div>
  )
}
