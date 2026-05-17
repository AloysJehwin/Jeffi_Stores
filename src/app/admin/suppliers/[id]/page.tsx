import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/jwt'
import SupplierDetailClient from './SupplierDetailClient'

export const dynamic = 'force-dynamic'

export default async function SupplierDetailPage({ params }: { params: { id: string } }) {
  const cookieStore = cookies()
  const token = cookieStore.get('admin_token')
  if (!token) redirect('/admin/login')

  try { await verifyToken(token.value) } catch { redirect('/admin/login') }

  return <SupplierDetailClient id={params.id} />
}
