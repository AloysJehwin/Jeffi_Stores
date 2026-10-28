import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import ProductDetailClient from '../ProductDetailClient'
import { adminCookieName } from '@/lib/auth/admin-cookie'
import { heldDraftForView } from '@/lib/admin/draft-locks'
import { draftsForProduct } from '@/lib/catalog/product-draft-id'
import EntityDrafts from '@/components/admin/drafts/EntityDrafts'
import { openProductDraft } from './actions'

export const dynamic = 'force-dynamic'

export default async function ProductViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const host = await getHost()
  const cookieStore = await cookies()
  const token = cookieStore.get(await adminCookieName())
  if (!token) redirect(ap('/admin/login', host))

  let hasInventory = false
  let me: string | null = null
  try {
    const payload = await verifyToken(token.value)
    me = (payload as { adminId?: string } | null)?.adminId ?? null
    const { hasPlanScope } = await import('@/lib/auth/plan-gate')
    hasInventory = await hasPlanScope(payload?.role ?? '', payload?.scopes ?? [], 'inventory:read')
  } catch {
    redirect(ap('/admin/login', host))
  }

  // heldDraft covers a never-published product (its own create-draft); edit drafts list below.
  const [held, drafts] = await Promise.all([
    heldDraftForView('product', id, `/admin/products/${id}/edit`, `/admin/products/${id}`),
    draftsForProduct(id, me),
  ])
  const panel =
    drafts.length > 0 ? (
      <EntityDrafts drafts={drafts} start={openProductDraft.bind(null, id)} back={`/admin/products/${id}`} me={me} noun="product" />
    ) : null
  return <ProductDetailClient id={id} hasInventory={hasInventory} heldDraft={held} draftsPanel={panel} />
}
