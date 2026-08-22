import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { getOwnerTenants } from '@/lib/tenant-registry'
import { runWithTenantContext, type TenantContext } from '@/lib/tenant-context'

export const dynamic = 'force-dynamic'

// Owner-triggered "Sync now" for a tenant's connected integration. Runs the SAME sync code as
// Jeffi's own admin sync, but inside runWithTenantContext(...) so the credential resolver picks
// THIS tenant's stored creds (their Merchant Center / Amazon account), not the platform env.

const Schema = z.object({
  tenantId: z.string().uuid(),
  provider: z.enum(['google_merchant', 'amazon_seller']),
})

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null)
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
  const { tenantId, provider } = parsed.data

  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const tenant = (await getOwnerTenants(owner.id)).find((t) => t.id === tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (tenant.status !== 'active') return NextResponse.json({ error: 'Store is not provisioned yet' }, { status: 409 })

  const ctx: TenantContext = {
    tenantId: tenant.id,
    slug: tenant.slug,
    plan: tenant.plan,
    infra: tenant.rds_endpoint
      ? {
          rdsEndpoint: tenant.rds_endpoint, rdsDb: 'jeffi_stores', rdsPort: 5432,
          dbSecretRef: null, iamAuth: true, s3Bucket: tenant.s3_bucket, region: tenant.region || 'us-east-1',
        }
      : null,
  }

  try {
    const result = await runWithTenantContext(ctx, async () => {
      if (provider === 'google_merchant') {
        const { syncAllProductsToMerchant } = await import('@/lib/merchant/sync')
        return syncAllProductsToMerchant()
      }
      const { syncAllProductsToAmazon } = await import('@/lib/amazon/sync')
      return syncAllProductsToAmazon()
    })
    return NextResponse.json({ ok: true, provider, result })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'sync failed' }, { status: 500 })
  }
}
