import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { testGoogleMerchant, testAmazonSeller, testMeta } from '@/lib/integrations/test-connection'

export const dynamic = 'force-dynamic'

const Body = z.object({ provider: z.enum(['google_merchant', 'amazon_seller', 'meta']) })

// One cheap read with the tenant's stored credentials. Always 200 with { ok, message } once the
// request is valid, so the popup can show the provider's reason.
export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null)
  const parsed = Body.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  const { provider } = parsed.data

  const admin = await requireAdminScope(request, provider === 'meta' ? 'campaigns:write' : 'merchant_sync:write')
  if (admin instanceof NextResponse) return admin
  const tenant = { tenantId: await credentialOwnerId() }

  const result =
    provider === 'google_merchant'
      ? await testGoogleMerchant()
      : provider === 'amazon_seller'
        ? await testAmazonSeller()
        : await testMeta(tenant.tenantId)
  return NextResponse.json(result)
}
