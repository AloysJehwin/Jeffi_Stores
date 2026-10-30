import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'

export const dynamic = 'force-dynamic'

// "Sync now" for a connected integration. The admin request runs in the store's context (or the
// flagship's, with no tenant), so the credential resolver picks that owner's stored creds.

const Schema = z.object({ provider: z.enum(['google_merchant', 'amazon_seller']) })

export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'merchant_sync:write')
  if (admin instanceof NextResponse) return admin

  const raw = await request.json().catch(() => null)
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  try {
    const result =
      parsed.data.provider === 'google_merchant'
        ? await (await import('@/lib/merchant/sync')).syncAllProductsToMerchant()
        : await (await import('@/lib/amazon/sync')).syncAllProductsToAmazon()
    return NextResponse.json({ ok: true, provider: parsed.data.provider, result })
  } catch (e: any) {
    if (e?.name === 'MerchantSyncInProgressError' || e?.name === 'AmazonSyncInProgressError') {
      return NextResponse.json({ ok: false, error: e.message, inProgress: true }, { status: 409 })
    }
    return NextResponse.json({ ok: false, error: e?.message || 'sync failed' }, { status: 500 })
  }
}
