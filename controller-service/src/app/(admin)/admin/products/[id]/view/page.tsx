import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import ProductDetailClient from '../ProductDetailClient'
import { adminCookieName } from '@/lib/auth/admin-cookie'
import { heldDraftForView } from '@/lib/admin/draft-locks'

export const dynamic = 'force-dynamic'

export default async function ProductViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const host = await getHost()
  const cookieStore = await cookies()
  const token = cookieStore.get(await adminCookieName())
  if (!token) redirect(ap('/admin/login', host))

  let hasInventory = false
  try {
    const payload = await verifyToken(token.value)
    const { hasPlanScope } = await import('@/lib/auth/plan-gate')
    hasInventory = await hasPlanScope(payload?.role ?? '', payload?.scopes ?? [], 'inventory:read')
  } catch {
    redirect(ap('/admin/login', host))
  }

  const held = await heldDraftForView('product', id, `/admin/products/${id}/edit`, `/admin/products/${id}`)
  return <ProductDetailClient id={id} hasInventory={hasInventory} heldDraft={held} />
}
