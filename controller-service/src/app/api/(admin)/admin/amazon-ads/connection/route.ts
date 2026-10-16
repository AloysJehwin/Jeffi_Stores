import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { query } from '@/lib/shared/db'
import { requireAdminScope } from '@/lib/auth/jwt'
import { channelError, readJson, withPlan } from '@/lib/channels/route'
import { oauthProviderInfo } from '@/lib/integrations/oauth'
import { adsApp, adsAppReady, adsEnvReady, amazonAdsTenantKey, disconnectAmazonAds, listProfiles, readAmazonAdsConfig, saveAmazonAdsConfig } from '@/lib/amazon-ads/client'

export const dynamic = 'force-dynamic'

/** Connection status, and the profiles the stored sign-in can reach while one is being picked. */
export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'amazon_ads:read'), 'amazon_ads:read', 'Amazon Ads')
  if (admin instanceof NextResponse) return admin
  const cfg = await readAmazonAdsConfig()
  let profiles: Awaited<ReturnType<typeof listProfiles>> = []
  let profileError: string | null = null
  if (cfg && !cfg.profile_id) {
    profiles = await listProfiles(cfg.refresh_token, adsApp(cfg)).catch(e => {
      profileError = String(e?.message ?? e)
      return []
    })
  }
  return NextResponse.json({
    envReady: adsEnvReady(),
    appReady: adsAppReady(cfg),
    ownApp: !!(cfg?.client_id && cfg.client_secret),
    clientId: cfg?.client_id ?? null,
    oauth: oauthProviderInfo('amazon_ads'),
    connected: !!cfg?.profile_id,
    pending: !!cfg && !cfg.profile_id,
    profileId: cfg?.profile_id ?? null,
    profileName: cfg?.profile_name ?? null,
    countryCode: cfg?.country_code ?? null,
    connectedVia: cfg?.connected_via ?? null,
    profiles,
    profileError,
  })
}

const Body = z
  .object({
    profileId: z.string().regex(/^\d{1,30}$/).optional(),
    refreshToken: z.string().min(20).max(2000).optional(),
    clientId: z.string().trim().regex(/^[\w.-]{8,200}$/).optional(),
    clientSecret: z.string().trim().min(8).max(500).optional(),
  })
  .refine(b => !!b.clientId === !!b.clientSecret, { message: 'Enter both the Client ID and the Client Secret of your Amazon Ads app.' })
  .refine(b => !!(b.profileId || b.refreshToken), { message: 'Give an Amazon Ads profile id (and a refresh token when entering by hand).' })

/** Choose the profile for a pending sign-in, or connect by hand with a refresh token (and the owner's own
 * app client id/secret). Without a profile id the entry is saved pending so a profile can be picked. */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'amazon_ads:write'), 'amazon_ads:write', 'Amazon Ads')
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  const b = parsed.data
  const current = await readAmazonAdsConfig()
  const refreshToken = b.refreshToken ?? current?.refresh_token
  if (!refreshToken) return NextResponse.json({ error: 'Sign in with Amazon first, or enter a refresh token.' }, { status: 409 })
  const own = b.clientId && b.clientSecret ? { client_id: b.clientId, client_secret: b.clientSecret } : current?.client_id && current.client_secret ? { client_id: current.client_id, client_secret: current.client_secret } : null
  if (!own && !adsEnvReady())
    return NextResponse.json({ error: 'Amazon Ads sign-in is not set up on this platform: enter the Client ID and Client Secret of your own Amazon Ads app.' }, { status: 400 })
  const app = adsApp(own)
  const via = b.refreshToken ? 'manual' : current?.connected_via ?? 'oauth'
  const tenantKey = await amazonAdsTenantKey()
  try {
    const profiles = await listProfiles(refreshToken, app)
    if (!b.profileId) {
      await saveAmazonAdsConfig(tenantKey, { refresh_token: refreshToken, ...(own ?? {}), connected_via: via })
      return NextResponse.json({ ok: true, pending: true, profiles })
    }
    const profile = profiles.find(p => p.profileId === b.profileId)
    if (!profile) return NextResponse.json({ error: 'That profile is not reachable with this sign-in.' }, { status: 400 })
    await saveAmazonAdsConfig(tenantKey, {
      refresh_token: refreshToken,
      ...(own ?? {}),
      profile_id: profile.profileId,
      profile_name: profile.name,
      country_code: profile.countryCode,
      currency_code: profile.currencyCode,
      connected_via: via,
    })
    await query(
      `INSERT INTO aads_profile (id, profile_id, name, country_code, currency_code) VALUES (1, $1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET profile_id = EXCLUDED.profile_id, name = EXCLUDED.name, country_code = EXCLUDED.country_code, currency_code = EXCLUDED.currency_code`,
      [profile.profileId, profile.name, profile.countryCode, profile.currencyCode]
    )
    return NextResponse.json({ ok: true, profile })
  } catch (e) {
    return channelError(e)
  }
}

/** Disconnect; synced data stays. */
export async function DELETE(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'amazon_ads:write'), 'amazon_ads:write', 'Amazon Ads')
  if (admin instanceof NextResponse) return admin
  await disconnectAmazonAds(await amazonAdsTenantKey())
  return NextResponse.json({ ok: true })
}
