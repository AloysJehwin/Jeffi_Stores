import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/jwt'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import ProductDetailClient from './ProductDetailClient'
import { adminCookieName } from '@/lib/admin-cookie'

export const dynamic = 'force-dynamic'

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const host = await getHost()
  const cookieStore = await cookies()
  const token = cookieStore.get(await adminCookieName())
  if (!token) redirect(ap('/admin/login', host))

  let hasInventory = false
  try {
    const payload = await verifyToken(token.value)
    const { hasPlanScope } = await import('@/lib/plan-gate')
    hasInventory = await hasPlanScope(payload?.role ?? '', payload?.scopes ?? [], 'inventory:read')
  } catch {
    redirect(ap('/admin/login', host))
  }

  return <ProductDetailClient id={id} hasInventory={hasInventory} />
}
