import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { query } from '@/lib/shared/db'
import { requireAdminScope } from '@/lib/auth/jwt'
import { channelError, readJson, withPlan } from '@/lib/channels/route'
import { oauthProviderInfo } from '@/lib/integrations/oauth'
import { disconnectMetaAds, listAdAccounts, metaAdsTenantKey, metaEnvReady, readMetaAdsConfig, saveMetaAdsConfig } from '@/lib/meta-ads/client'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'meta_ads:read'), 'meta_ads:read', 'Meta Ads')
  if (admin instanceof NextResponse) return admin
  const cfg = await readMetaAdsConfig()
  let accounts: Awaited<ReturnType<typeof listAdAccounts>> = []
  let accountError: string | null = null
  if (cfg && !cfg.ad_account_id) {
    accounts = await listAdAccounts(cfg.access_token).catch(e => {
      accountError = String(e?.message ?? e)
      return []
    })
  }
  return NextResponse.json({
    envReady: metaEnvReady(),
    oauth: oauthProviderInfo('meta_ads'),
    connected: !!cfg?.ad_account_id,
    pending: !!cfg && !cfg.ad_account_id,
    adAccountId: cfg?.ad_account_id ?? null,
    adAccountName: cfg?.ad_account_name ?? null,
    pixelId: cfg?.pixel_id ?? null,
    capiToken: !!cfg?.capi_token,
    tokenExpiresAt: cfg?.token_expires_at ?? null,
    connectedVia: cfg?.connected_via ?? null,
    accounts,
    accountError,
  })
}

const Body = z.object({
  adAccountId: z.string().regex(/^(act_)?\d{1,30}$/).optional(),
  accessToken: z.string().min(20).max(1000).optional(),
  pixelId: z.string().regex(/^\d{5,30}$/).nullable().optional(),
  capiToken: z.string().min(20).max(1000).nullable().optional(),
})

/** Pick the ad account, connect by hand (system user token + account), or set the pixel for the Conversions API. */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'meta_ads:write'), 'meta_ads:write', 'Meta Ads')
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  const b = parsed.data
  const current = await readMetaAdsConfig()
  const token = b.accessToken ?? current?.access_token
  if (!token) return NextResponse.json({ error: 'Connect with Facebook first, or enter an access token.' }, { status: 409 })
  try {
    const next = { ...(current ?? { connected_via: 'manual' as const }), access_token: token }
    if (b.accessToken) Object.assign(next, { connected_via: 'manual', token_expires_at: null })
    if (b.adAccountId) {
      const id = b.adAccountId.startsWith('act_') ? b.adAccountId : `act_${b.adAccountId}`
      const acct = (await listAdAccounts(token)).find(a => a.id === id)
      if (!acct) return NextResponse.json({ error: 'That ad account is not reachable with this token.' }, { status: 400 })
      Object.assign(next, { ad_account_id: acct.id, ad_account_name: acct.name, currency: acct.currency })
      await query(
        `INSERT INTO mads_account (id, ad_account_id, name, currency, account_status) VALUES (1,$1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET ad_account_id=EXCLUDED.ad_account_id, name=EXCLUDED.name, currency=EXCLUDED.currency, account_status=EXCLUDED.account_status`,
        [acct.id, acct.name, acct.currency, acct.status]
      )
    }
    if (b.pixelId !== undefined) Object.assign(next, { pixel_id: b.pixelId ?? undefined })
    if (b.capiToken !== undefined) Object.assign(next, { capi_token: b.capiToken ?? undefined })
    await saveMetaAdsConfig(await metaAdsTenantKey(), next as any)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return channelError(e)
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'meta_ads:write'), 'meta_ads:write', 'Meta Ads')
  if (admin instanceof NextResponse) return admin
  await disconnectMetaAds(await metaAdsTenantKey())
  return NextResponse.json({ ok: true })
}
