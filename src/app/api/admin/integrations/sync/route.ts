import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/jwt'
import { getCurrentTenant } from '@/lib/tenant-context'

export const dynamic = 'force-dynamic'

// Store-admin "Sync now" for a connected integration. The admin request already runs inside the
// tenant's ALS context (resolved from the admin host), so the credential resolver picks THIS
// tenant's stored creds — no context rebuild needed. Off-tenant (no ALS) it is rejected rather
// than falling back to the platform account.

const Schema = z.object({ provider: z.enum(['google_merchant', 'amazon_seller']) })

export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'merchant_sync:write')
  if (admin instanceof NextResponse) return admin
  if (!getCurrentTenant()) return NextResponse.json({ error: 'No tenant context' }, { status: 400 })

  const raw = await request.json().catch(() => null)
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  try {
    const result = parsed.data.provider === 'google_merchant'
      ? await (await import('@/lib/merchant/sync')).syncAllProductsToMerchant()
      : await (await import('@/lib/amazon/sync')).syncAllProductsToAmazon()
    return NextResponse.json({ ok: true, provider: parsed.data.provider, result })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'sync failed' }, { status: 500 })
  }
}
