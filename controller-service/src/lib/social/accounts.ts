import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { decryptToken, encryptToken } from '@/lib/crypto/token-cipher'
import { PLATFORM_TENANT_ID } from '@/lib/import/jobs'
import { providerFor } from './providers'
import type { Network, SocialAuth, TokenSet } from './providers/types'

// Connected social accounts per store (tenant_social_accounts). Facebook and Instagram keep the
// existing row shape (Page token, page_id, ig_user_id) and the platform's own Meta account comes
// from env. The newer networks store an encrypted JSON token set and the chosen target; the
// platform's are keyed to the platform tenant. Expired tokens are refreshed here and saved back.

export interface AccountRow {
  provider: Network
  page_id: string | null
  page_name: string | null
  ig_user_id: string | null
  access_token_enc: string
  token_expiry: string | null
  status: string
}

const keyFor = (tenantId: string | null) => tenantId ?? PLATFORM_TENANT_ID

export async function listAccounts(tenantId: string | null): Promise<AccountRow[]> {
  const r = await controlPlanePool().query(`SELECT provider, page_id, page_name, ig_user_id, access_token_enc, token_expiry, status FROM tenant_social_accounts WHERE tenant_id = $1`, [keyFor(tenantId)])
  return r.rows as AccountRow[]
}

interface StoredTokens extends TokenSet {
  extra?: Record<string, string>
}

function readTokens(row: AccountRow): StoredTokens {
  const raw = decryptToken(row.access_token_enc)
  try {
    const j = JSON.parse(raw)
    if (j && typeof j.accessToken === 'string') return j
  } catch {}
  return { accessToken: raw }
}

/** Save a sign-in (status pending until a target is chosen when `target` is omitted). */
export async function saveNetworkAccount(tenantId: string | null, network: Network, tokens: StoredTokens, target?: { id: string; name: string | null } | null): Promise<void> {
  await controlPlanePool().query(
    `INSERT INTO tenant_social_accounts (tenant_id, provider, page_id, page_name, access_token_enc, token_expiry, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tenant_id, provider) DO UPDATE SET page_id = COALESCE(EXCLUDED.page_id, tenant_social_accounts.page_id),
       page_name = COALESCE(EXCLUDED.page_name, tenant_social_accounts.page_name), access_token_enc = EXCLUDED.access_token_enc,
       token_expiry = EXCLUDED.token_expiry, status = EXCLUDED.status, updated_at = now()`,
    [keyFor(tenantId), network, target?.id ?? null, target?.name ?? null, encryptToken(JSON.stringify(tokens)), tokens.expiresAt ?? null, target ? 'connected' : 'pending']
  )
}

export async function chooseTarget(tenantId: string | null, network: Network, target: { id: string; name: string }): Promise<void> {
  await controlPlanePool().query(
    `UPDATE tenant_social_accounts SET page_id = $3, page_name = $4, status = 'connected', updated_at = now() WHERE tenant_id = $1 AND provider = $2`,
    [keyFor(tenantId), network, target.id, target.name]
  )
}

export async function disconnectNetwork(tenantId: string | null, network: Network): Promise<void> {
  await controlPlanePool().query(`DELETE FROM tenant_social_accounts WHERE tenant_id = $1 AND provider = $2`, [keyFor(tenantId), network])
}

/** The pending sign-in's access token, for the target picker. */
export async function pendingToken(tenantId: string | null, network: Network): Promise<string | null> {
  const row = (await listAccounts(tenantId)).find(a => a.provider === network)
  return row ? readTokens(row).accessToken : null
}

function metaEnvAuth(network: Network): SocialAuth | null {
  const token = process.env.META_JEFFI_PAGE_TOKEN
  const target = network === 'facebook' ? process.env.META_JEFFI_PAGE_ID : process.env.META_JEFFI_IG_USER_ID
  return token && target ? { accessToken: token, targetId: target } : null
}

const EXPIRY_MARGIN_MS = 5 * 60_000

/** Credentials to post to `network` for this store, refreshing an expired token. Null when not connected. */
export async function authFor(tenantId: string | null, network: Network): Promise<SocialAuth | null> {
  const rows = await listAccounts(tenantId)
  if (network === 'facebook' || network === 'instagram') {
    const fb = rows.find(a => a.provider === 'facebook')
    const ig = rows.find(a => a.provider === 'instagram')
    const src = network === 'instagram' ? ig : (fb ?? ig)
    const target = network === 'instagram' ? ig?.ig_user_id : (fb ?? src)?.page_id
    // The flagship connects through the same gear; env is only its fallback.
    if (!src || !target) return tenantId ? null : metaEnvAuth(network)
    return { accessToken: decryptToken(src.access_token_enc), targetId: target, targetName: src.page_name }
  }
  const row = rows.find(a => a.provider === network && a.status === 'connected')
  if (!row?.page_id) return null
  const tokens = readTokens(row)
  const auth: SocialAuth = { ...tokens, targetId: row.page_id, targetName: row.page_name }
  const expired = tokens.expiresAt && new Date(tokens.expiresAt).getTime() - EXPIRY_MARGIN_MS < Date.now()
  const refresh = providerFor(network).oauth?.refresh
  if (expired && tokens.refreshToken && refresh) {
    const next = await refresh(auth)
    const merged: StoredTokens = { ...tokens, ...next, refreshToken: next.refreshToken ?? tokens.refreshToken }
    await saveNetworkAccount(tenantId, network, merged, { id: row.page_id, name: row.page_name })
    return { ...auth, ...merged }
  }
  return auth
}
