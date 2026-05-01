import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import QuotationsClient from './QuotationsClient'

export const metadata = {
  title: 'Quotations — Jeffi Admin',
}

export default async function QuotationsPage() {
  const cookieStore = cookies()
  const token = cookieStore.get('admin_token')
  if (!token) redirect('/admin/login')

  let session: any = null
  try {
    session = await verifyToken(token.value)
  } catch {
    redirect('/admin/login')
  }

  if (!hasScope(session?.role || '', session?.scopes || [], 'quotations')) {
    redirect('/admin/dashboard')
  }

  return (
    <div className="p-4 sm:p-6">
      <QuotationsClient />
    </div>
  )
}
