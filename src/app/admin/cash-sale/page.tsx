import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import CashSaleClient from './CashSaleClient'

export const metadata = { title: 'Cash Sale — Jeffi Admin' }

export default async function CashSalePage() {
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
      <CashSaleClient />
    </div>
  )
}
