import {
  controlPlanePool,
  deleteIntegrationCredential,
  deleteTenantSocialAccount,
  getIntegrationCredential,
  getTenantSocialAccounts,
  saveIntegrationCredential,
  saveTenantSocialAccount,
} from '@/lib/tenant-registry'
import { decryptToken, encryptToken } from '@/lib/crypto/token-cipher'
import { META_INSIGHTS_SCOPES, findMetaConfig, tokenScopes, type MetaAppSource, type MetaPage } from '@/lib/catalog/meta'

// Facebook sign-in for Social Posts: the store picks a Page when the user manages more than one, and
// connections that lack the insights and comments permissions are flagged for a reconnect.

/** A sign-in waiting for its Page. In the control-plane DB, not Redis: the callback runs on the platform's
 * pods and the picker on the store's, which have their own Redis. */
export const META_PAGE_PICK_PROVIDER = 'meta_page_pick'
const PICK_TTL_MS = 15 * 60_000

export interface MetaSignIn {
  userToken: string
  fbUserId: string
  granted: string[]
  metaApp: MetaAppSource
}

/** Saves a Page and its linked Instagram account as the store's Facebook / Instagram connection. */
export async function saveMetaPage(tenantId: string, page: MetaPage, s: { fbUserId: string; granted: string[] }): Promise<void> {
  const base = {
    tenantId,
    pageId: page.pageId,
    pageName: page.pageName,
    accessTokenEnc: encryptToken(page.pageAccessToken),
    tokenExpiry: null,
    fbUserId: s.fbUserId,
    grantedScopes: s.granted,
  }
  await saveTenantSocialAccount({ ...base, provider: 'facebook' })
  if (page.igUserId) await saveTenantSocialAccount({ ...base, provider: 'instagram', igUserId: page.igUserId })
  // The Page has no linked IG business account any more; drop a stale IG row.
  else await deleteTenantSocialAccount(tenantId, 'instagram')
}

export async function savePendingPagePick(tenantId: string, s: MetaSignIn): Promise<void> {
  await saveIntegrationCredential({
    tenantId,
    provider: META_PAGE_PICK_PROVIDER,
    label: 'Facebook Page to choose',
    configEnc: encryptToken(JSON.stringify(s)),
    meta: { fb_user_id: s.fbUserId },
    expiresAt: new Date(Date.now() + PICK_TTL_MS),
  })
}

export async function clearPendingPagePick(tenantId: string): Promise<void> {
  await deleteIntegrationCredential(tenantId, META_PAGE_PICK_PROVIDER)
}

export async function readPendingPagePick(tenantId: string): Promise<MetaSignIn | null> {
  const row = await getIntegrationCredential(tenantId, META_PAGE_PICK_PROVIDER).catch(() => null)
  if (!row) return null
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    await clearPendingPagePick(tenantId).catch(() => {})
    return null
  }
  try {
    return JSON.parse(decryptToken(row.config_enc)) as MetaSignIn
  } catch {
    return null
  }
}

/** Insights and comments permissions the store's Meta connection lacks; empty when connected with them or unknown. */
export async function missingMetaPermissions(tenantId: string): Promise<string[]> {
  const rows = await getTenantSocialAccounts(tenantId)
  const row = rows.find(r => r.provider === 'facebook') ?? rows.find(r => r.provider === 'instagram')
  if (!row) return []
  let granted = row.granted_scopes ?? null
  if (!granted) {
    // Connected before the grant was recorded: ask Meta once and keep the answer.
    const cfg = await findMetaConfig(tenantId)
    granted = cfg ? await tokenScopes(decryptToken(row.access_token_enc), cfg) : null
    if (!granted) return []
    await controlPlanePool().query(
      `UPDATE tenant_social_accounts SET granted_scopes = $2 WHERE tenant_id = $1 AND provider IN ('facebook','instagram')`,
      [tenantId, granted]
    )
  }
  return META_INSIGHTS_SCOPES.filter(s => !granted!.includes(s))
}
