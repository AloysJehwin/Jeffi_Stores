import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { query } from '@/lib/shared/db'
import { requireAdminScope } from '@/lib/auth/jwt'
import { channelError, readJson, withPlan } from '@/lib/channels/route'
import { oauthProviderInfo } from '@/lib/integrations/oauth'
import { adsEnvReady, amazonAdsTenantKey, disconnectAmazonAds, listProfiles, readAmazonAdsConfig, saveAmazonAdsConfig } from '@/lib/amazon-ads/client'

export const dynamic = 'force-dynamic'

/** Connection status, and the profiles the stored sign-in can reach while one is being picked. */
export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'amazon_ads:read'), 'amazon_ads:read', 'Amazon Ads')
  if (admin instanceof NextResponse) return admin
  const cfg = await readAmazonAdsConfig()
  let profiles: Awaited<ReturnType<typeof listProfiles>> = []
  let profileError: string | null = null
  if (cfg && !cfg.profile_id) {
    profiles = await listProfiles(cfg.refresh_token).catch(e => {
      profileError = String(e?.message ?? e)
      return []
    })
  }
  return NextResponse.json({
    envReady: adsEnvReady(),
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

const Body = z.object({ profileId: z.string().regex(/^\d{1,30}$/), refreshToken: z.string().min(20).max(2000).optional() })

/** Choose the profile for a pending sign-in, or connect by hand with a refresh token and profile id. */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'amazon_ads:write'), 'amazon_ads:write', 'Amazon Ads')
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: 'Give an Amazon Ads profile id (and a refresh token when entering by hand).' }, { status: 400 })
  const current = await readAmazonAdsConfig()
  const refreshToken = parsed.data.refreshToken ?? current?.refresh_token
  if (!refreshToken) return NextResponse.json({ error: 'Sign in with Amazon first, or enter a refresh token.' }, { status: 409 })
  try {
    const profile = (await listProfiles(refreshToken)).find(p => p.profileId === parsed.data.profileId)
    if (!profile) return NextResponse.json({ error: 'That profile is not reachable with this sign-in.' }, { status: 400 })
    await saveAmazonAdsConfig(await amazonAdsTenantKey(), {
      refresh_token: refreshToken,
      profile_id: profile.profileId,
      profile_name: profile.name,
      country_code: profile.countryCode,
      currency_code: profile.currencyCode,
      connected_via: parsed.data.refreshToken ? 'manual' : current?.connected_via ?? 'oauth',
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
