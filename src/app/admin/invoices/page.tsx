import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { ap } from '@/lib/admin-path'
import InvoicesClient from './InvoicesClient'

export const metadata = { title: 'Invoices — Jeffi Admin' }

export default async function InvoicesPage() {
  const cookieStore = cookies()
  const token = cookieStore.get('admin_token')
  const host = (await headers()).get('host') ?? ''
  if (!token) redirect(ap('/admin/login', host))

  let session: any = null
  try { session = await verifyToken(token.value) } catch { redirect(ap('/admin/login', host)) }

  if (!hasScope(session?.role || '', session?.scopes || [], 'invoices')) {
    redirect(ap('/admin/dashboard', host))
  }

  return (
    <div className="p-4 sm:p-6">
      <InvoicesClient />
    </div>
  )
}
