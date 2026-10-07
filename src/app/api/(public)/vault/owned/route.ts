import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'
import { vaultItemUrl } from '@/lib/vault/links'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Whether the signed-in buyer already holds active vault access to a product, plus its vault link. */
export async function GET(request: NextRequest) {
  const productId = request.nextUrl.searchParams.get('productId') || ''
  if (!UUID.test(productId)) return NextResponse.json({ error: 'Invalid productId' }, { status: 400 })

  const user = await authenticateAnyUser(request).catch(() => null)
  if (!user) return NextResponse.json({ owned: false, url: null }, { headers: { 'Cache-Control': 'no-store' } })

  try {
    const row = await queryOne<{ id: string }>(
      `SELECT id FROM vault_entitlements
        WHERE user_id = $1 AND product_id = $2 AND status = 'active'
          AND (access_expires_at IS NULL OR access_expires_at > NOW())
        LIMIT 1`,
      [user.userId, productId]
    )
    const owned = !!row
    return NextResponse.json(
      { owned, url: owned ? await vaultItemUrl(productId) : null },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch {
    return NextResponse.json({ owned: false, url: null }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
