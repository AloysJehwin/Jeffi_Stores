import { cookies} from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/jwt'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import ProductDetailClient from './ProductDetailClient'

export const dynamic = 'force-dynamic'

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const host = await getHost()
  const cookieStore = await cookies()
  const token = cookieStore.get('admin_token')
  if (!token) redirect(ap('/admin/login', host))

  try { await verifyToken(token.value) } catch { redirect(ap('/admin/login', host)) }

  return <ProductDetailClient id={id} />
}
