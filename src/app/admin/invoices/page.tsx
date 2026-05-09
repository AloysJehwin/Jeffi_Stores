import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import InvoicesClient from './InvoicesClient'

export const metadata = { title: 'Invoices — Jeffi Admin' }

export default async function InvoicesPage() {
  const cookieStore = cookies()
  const token = cookieStore.get('admin_token')
  if (!token) redirect('/admin/login')

  let session: any = null
  try { session = await verifyToken(token.value) } catch { redirect('/admin/login') }

  if (!hasScope(session?.role || '', session?.scopes || [], 'invoices')) {
    redirect('/admin/dashboard')
  }

  return (
    <div className="p-4 sm:p-6">
      <InvoicesClient />
    </div>
  )
}
