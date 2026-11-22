import { decryptToken, encryptToken } from '@/lib/crypto/token-cipher'
import { PLATFORM_TENANT_ID } from '@/lib/import/jobs'
import { deleteIntegrationCredential, getIntegrationCredential, saveIntegrationCredential } from '@/lib/tenant-registry/integrations'

// OAuth apps per integration family, entered in the admin portal (Meta keeps its own in
// lib/catalog/meta). A store signs in with its own saved app; without one, with the platform's
// default: the app the flagship saved in its portal, else env keys. Tokens stay per store either
// way; only the app that shows the consent screen changes. The app that signed a store in is
// recorded in the OAuth state and stored with its tokens, so code exchange and refresh use it.

export const OWN_APP_FAMILIES = ['google', 'amazon_seller', 'amazon_ads', 'pinterest', 'linkedin', 'x'] as const
export type OwnAppFamily = (typeof OWN_APP_FAMILIES)[number]
export type AppSource = 'own' | 'platform'

export interface OAuthApp {
  clientId: string
  clientSecret: string
  /** Amazon SP-API: the app's application id (amzn1.sp.solution…), which the consent URL names. */
  applicationId?: string | null
}

export const isOwnAppFamily = (v: unknown): v is OwnAppFamily => typeof v === 'string' && (OWN_APP_FAMILIES as readonly string[]).includes(v)

/** Env keys of the platform app for each family. */
export const PLATFORM_APP_ENV: Record<OwnAppFamily, { clientId: string; clientSecret: string; applicationId?: string }> = {
  google: { clientId: 'GOOGLE_OAUTH_CLIENT_ID', clientSecret: 'GOOGLE_OAUTH_CLIENT_SECRET' },
  amazon_seller: { clientId: 'AMAZON_LWA_APP_CLIENT_ID', clientSecret: 'AMAZON_LWA_APP_CLIENT_SECRET', applicationId: 'AMAZON_SP_APP_ID' },
  amazon_ads: { clientId: 'AMAZON_ADS_CLIENT_ID', clientSecret: 'AMAZON_ADS_CLIENT_SECRET' },
  pinterest: { clientId: 'PINTEREST_APP_ID', clientSecret: 'PINTEREST_APP_SECRET' },
  linkedin: { clientId: 'LINKEDIN_CLIENT_ID', clientSecret: 'LINKEDIN_CLIENT_SECRET' },
  x: { clientId: 'X_CLIENT_ID', clientSecret: 'X_CLIENT_SECRET' },
}

export const OWN_APP_LABEL: Record<OwnAppFamily, string> = {
  google: 'Google OAuth client',
  amazon_seller: 'Amazon Selling Partner app',
  amazon_ads: 'Amazon Ads (Login with Amazon) app',
  pinterest: 'Pinterest app',
  linkedin: 'LinkedIn app',
  x: 'X app',
}

/** Which family's app signs a store in to each social network. */
export const NETWORK_APP_FAMILY: Record<'gbp' | 'youtube' | 'pinterest' | 'linkedin' | 'x', OwnAppFamily> = {
  gbp: 'google',
  youtube: 'google',
  pinterest: 'pinterest',
  linkedin: 'linkedin',
  x: 'x',
}

const providerKey = (family: OwnAppFamily) => `oauth_app:${family}`
const clean = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/^["']+|["']+$/g, '').trim() : '')

/** The env app, or null when its keys are not all set. */
export function platformApp(family: OwnAppFamily): OAuthApp | null {
  const env = PLATFORM_APP_ENV[family]
  const clientId = clean(process.env[env.clientId])
  const clientSecret = clean(process.env[env.clientSecret])
  const applicationId = env.applicationId ? clean(process.env[env.applicationId]) : null
  if (!clientId || !clientSecret || (env.applicationId && !applicationId)) return null
  return { clientId, clientSecret, ...(env.applicationId ? { applicationId } : {}) }
}

export async function readOwnApp(tenantId: string, family: OwnAppFamily): Promise<OAuthApp | null> {
  const row = await getIntegrationCredential(tenantId, providerKey(family)).catch(() => null)
  if (!row || row.status !== 'connected') return null
  try {
    const j = JSON.parse(decryptToken(row.config_enc))
    const clientId = clean(j?.clientId)
    const clientSecret = clean(j?.clientSecret)
    if (!clientId || !clientSecret) return null
    const applicationId = clean(j?.applicationId) || null
    if (family === 'amazon_seller' && !applicationId) return null
    return { clientId, clientSecret, ...(applicationId ? { applicationId } : {}) }
  } catch {
    return null
  }
}

export async function saveOwnApp(tenantId: string, family: OwnAppFamily, app: OAuthApp): Promise<void> {
  await saveIntegrationCredential({
    tenantId,
    provider: providerKey(family),
    label: OWN_APP_LABEL[family],
    configEnc: encryptToken(JSON.stringify(app)),
    meta: { client_id: app.clientId, application_id: app.applicationId ?? null },
  })
}

export async function deleteOwnApp(tenantId: string, family: OwnAppFamily): Promise<void> {
  await deleteIntegrationCredential(tenantId, providerKey(family))
}

/** Every store's default: the app the flagship saved in its portal, else the env app. */
export async function platformDefaultApp(family: OwnAppFamily): Promise<OAuthApp | null> {
  return (await readOwnApp(PLATFORM_TENANT_ID, family)) ?? platformApp(family)
}

/** The app a store signs in with: its own when saved, else the platform default; null when neither exists. */
export async function resolveOAuthApp(
  tenantId: string | null | undefined,
  family: OwnAppFamily
): Promise<{ app: OAuthApp; source: AppSource } | null> {
  const own = tenantId ? await readOwnApp(tenantId, family) : null
  if (own) return { app: own, source: 'own' }
  const platform = await platformDefaultApp(family)
  return platform ? { app: platform, source: 'platform' } : null
}

/** The app recorded in an OAuth state (the one that opened the consent screen), for the code exchange. */
export async function appForSource(tenantId: string | null | undefined, family: OwnAppFamily, source: AppSource | undefined): Promise<OAuthApp | null> {
  if (source === 'own') return tenantId ? readOwnApp(tenantId, family) : null
  return platformDefaultApp(family)
}

const isEnvApp = (app: OAuthApp) =>
  OWN_APP_FAMILIES.some(f => clean(process.env[PLATFORM_APP_ENV[f].clientId]) === app.clientId)

/** The fields to store with a connection's tokens so refresh uses the app that issued them: any
 * portal-saved app (the store's or the flagship's); nothing for an env app, which refresh falls back to. */
export function appFieldsForTokens(app: OAuthApp | null, _source?: AppSource): { client_id?: string; client_secret?: string } {
  return app && !isEnvApp(app) ? { client_id: app.clientId, client_secret: app.clientSecret } : {}
}
