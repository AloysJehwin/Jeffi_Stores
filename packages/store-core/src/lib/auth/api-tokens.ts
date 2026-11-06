import crypto from 'node:crypto'
import type { PoolClient } from 'pg'
import { controlPlanePool } from '@/lib/tenant-registry'
import { ROOT_DOMAIN } from '@/lib/tenant-registry/shared'
import { FLAGSHIP_TENANT_ID } from '@/lib/payments/wallet'
import { ALL_SCOPE_KEYS, hasScope, TENANT_SCOPE_KEYS } from '@/lib/auth/scopes'

// Admin API credentials in the control plane (admin_api_tokens), so the public gateway can find a
// token's store without opening store DBs. jfc_ = a person's token (device login, extension card),
// jsa_ = a service account's key. Only sha256 is stored; the plaintext is returned exactly once.
// A token's scopes are an upper bound: the store intersects them with the holder's current grant.

export type ApiTokenKind = 'cli' | 'service_account' | 'extension'
export type ApiTokenStatus = 'pending' | 'denied' | 'active' | 'revoked'

export const ALL_SCOPES = '*'
export const DEVICE_CODE_TTL_S = 600
export const DEVICE_POLL_INTERVAL_S = 5
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ' // no vowels or look-alikes

/** The store a token belongs to; the flagship (no tenant) is the nil uuid. */
export const storeTenantId = (tenantId: string | null | undefined): string => tenantId || FLAGSHIP_TENANT_ID

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

export const isApiToken = (s: string | null | undefined): s is string => !!s && /^(jfc|jsa)_[A-Za-z0-9_-]{32,64}$/.test(s)

export function newToken(kind: ApiTokenKind): { plain: string; prefix: string; hash: string } {
  const plain = (kind === 'service_account' ? 'jsa_' : 'jfc_') + crypto.randomBytes(32).toString('base64url')
  return { plain, prefix: plain.slice(0, 12), hash: sha256(plain) }
}

function newUserCode(): string {
  let s = ''
  for (let i = 0; i < 8; i++) s += USER_CODE_ALPHABET[crypto.randomInt(USER_CODE_ALPHABET.length)]
  return `${s.slice(0, 4)}-${s.slice(4)}`
}

// Lifetimes a person may pick; an administrator's token lives at most a day.
export const TOKEN_TTLS: Record<string, number> = { '1h': 3600, '12h': 43200, '24h': 86400, '7d': 604800 }
export const DEFAULT_TTL = '12h'
const MAX_TTL_ADMINISTRATOR = 86400

/** Seconds for a TTL label ('1h' … '7d') or a number of seconds, capped for the role; null if unknown. */
export function tokenTtlSeconds(raw: unknown, role: string): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? (TOKEN_TTLS[raw] ?? (/^\d+$/.test(raw) ? Number(raw) : NaN)) : TOKEN_TTLS[DEFAULT_TTL]
  if (!Number.isFinite(n) || n < 60 || n > TOKEN_TTLS['7d']) return null
  return role === 'administrator' ? Math.min(n, MAX_TTL_ADMINISTRATOR) : n
}

/**
 * The scopes a person may give a token: 'all' (["*"], everything they hold, now and later), 'read'
 * (every :read scope they hold), or a list, each of which they must hold. null when the list asks for more.
 */
export function grantableScopes(requested: unknown, holder: { role: string; scopes: string[]; tenantId: string | null }): string[] | null {
  const keys = holder.tenantId ? TENANT_SCOPE_KEYS : ALL_SCOPE_KEYS
  if (requested === undefined || requested === null || requested === 'all' || requested === ALL_SCOPES) return [ALL_SCOPES]
  if (requested === 'read') return keys.filter(k => k.endsWith(':read') && hasScope(holder.role, holder.scopes, k))
  const list = Array.isArray(requested) ? requested : typeof requested === 'string' ? requested.split(/[\s,]+/) : null
  if (!list) return null
  const want = [...new Set(list.map(String).map(s => s.trim()).filter(Boolean))]
  if (want.includes(ALL_SCOPES)) return [ALL_SCOPES]
  if (!want.length || want.some(k => !keys.includes(k) || !hasScope(holder.role, holder.scopes, k))) return null
  return want
}

/** XXXX-XXXX from whatever the person typed (any case, with or without the dash), or null. */
export function normaliseUserCode(raw: string | null | undefined): string | null {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '')
  if (s.length !== 8 || [...s].some(c => !USER_CODE_ALPHABET.includes(c))) return null
  return `${s.slice(0, 4)}-${s.slice(4)}`
}

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505'
const clip = (s: string | null | undefined, n: number) => (s ? String(s).slice(0, n) : null)

export interface ClientInfo {
  host: string
  clientName?: string | null
  clientIp?: string | null
  userAgent?: string | null
}

/** The store's public API origin (public-{slug}.<root>, public.<root> for the flagship) seen from its admin host. */
export function publicApiOrigin(adminHost: string, slug: string | null): string {
  const [name, port] = adminHost.toLowerCase().split(':')
  const label = slug ? `public-${slug}` : 'public'
  return name === 'localhost' || name.endsWith('.localhost') ? `http://${label}.localhost${port ? `:${port}` : ''}` : `https://${label}.${ROOT_DOMAIN}`
}

/** Host, caller IP and user agent of a request, recorded with a token. */
export function clientInfoFrom(req: { headers: Headers }, clientName?: string | null): ClientInfo {
  const h = req.headers
  const first = (v: string | null) => (v ? v.split(',')[0].trim() : null)
  return { host: first(h.get('x-forwarded-host')) || first(h.get('host')) || '', clientName: clientName ?? null, clientIp: first(h.get('x-forwarded-for')) || h.get('x-real-ip'), userAgent: h.get('user-agent') }
}

// ── Device login (RFC 8628) ──

export async function startDeviceAuth(tenantId: string | null, client: ClientInfo): Promise<{ deviceCode: string; userCode: string; expiresIn: number; interval: number }> {
  const pool = controlPlanePool()
  const tid = storeTenantId(tenantId)
  // Old unfinished logins of this store.
  await pool
    .query(`DELETE FROM admin_api_tokens WHERE tenant_id = $1 AND status IN ('pending','denied') AND created_at < now() - interval '1 day'`, [tid])
    .catch(() => {})
  for (let attempt = 0; ; attempt++) {
    const deviceCode = crypto.randomBytes(32).toString('base64url')
    const userCode = newUserCode()
    try {
      await pool.query(
        `INSERT INTO admin_api_tokens (tenant_id, kind, status, device_code_hash, user_code, host, client_name, client_ip, user_agent, expires_at)
         VALUES ($1, 'cli', 'pending', $2, $3, $4, $5, $6, $7, now() + make_interval(secs => $8))`,
        [tid, sha256(deviceCode), userCode, clip(client.host, 255), clip(client.clientName, 120), clip(client.clientIp, 64), clip(client.userAgent, 500), DEVICE_CODE_TTL_S]
      )
      return { deviceCode, userCode, expiresIn: DEVICE_CODE_TTL_S, interval: DEVICE_POLL_INTERVAL_S }
    } catch (e) {
      if (!isUniqueViolation(e) || attempt >= 4) throw e
    }
  }
}

export type PollResult =
  | { error: 'authorization_pending' | 'slow_down' | 'access_denied' | 'expired_token' }
  | { token: string; expiresAt: string | null; scopes: string[] }

async function inTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await controlPlanePool().connect()
  try {
    await c.query('BEGIN')
    const out = await fn(c)
    await c.query('COMMIT')
    return out
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

/** One poll of the CLI. The token is minted on the first poll after approval and never shown again. */
export async function pollDeviceAuth(deviceCode: string, tenantId: string | null): Promise<PollResult> {
  if (!deviceCode || deviceCode.length > 128) return { error: 'expired_token' }
  return inTx(async c => {
    const r = await c.query<{ id: string; tenant_id: string; status: ApiTokenStatus; token_hash: string | null; scopes: string[]; expires_at: string | null; pending_expired: boolean; polled_recently: boolean; stale: boolean }>(
      `SELECT id, tenant_id, status, token_hash, scopes, expires_at,
              (expires_at IS NOT NULL AND expires_at <= now()) AS pending_expired,
              (last_used_at IS NOT NULL AND last_used_at > now() - make_interval(secs => $2)) AS polled_recently,
              (approved_at IS NOT NULL AND approved_at < now() - make_interval(secs => $3)) AS stale
         FROM admin_api_tokens WHERE device_code_hash = $1 FOR UPDATE`,
      [sha256(deviceCode), DEVICE_POLL_INTERVAL_S - 1, DEVICE_CODE_TTL_S]
    )
    const row = r.rows[0]
    if (!row || row.tenant_id !== storeTenantId(tenantId)) return { error: 'expired_token' as const }
    if (row.status === 'pending') {
      if (row.pending_expired) return { error: 'expired_token' as const }
      await c.query(`UPDATE admin_api_tokens SET last_used_at = now() WHERE id = $1`, [row.id])
      return { error: row.polled_recently ? ('slow_down' as const) : ('authorization_pending' as const) }
    }
    if (row.status === 'denied') {
      await c.query(`UPDATE admin_api_tokens SET device_code_hash = NULL WHERE id = $1`, [row.id])
      return { error: 'access_denied' as const }
    }
    // An approval the CLI never collected in time is dropped, not minted later.
    if (row.status !== 'active' || row.token_hash || row.pending_expired || row.stale) {
      if (row.status === 'active' && !row.token_hash) await c.query(`DELETE FROM admin_api_tokens WHERE id = $1`, [row.id])
      return { error: 'expired_token' as const }
    }
    const t = newToken('cli')
    await c.query(`UPDATE admin_api_tokens SET token_hash = $2, token_prefix = $3, device_code_hash = NULL, last_used_at = NULL WHERE id = $1`, [row.id, t.hash, t.prefix])
    return { token: t.plain, expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null, scopes: Array.isArray(row.scopes) ? row.scopes : [] }
  })
}

export interface PendingDevice {
  id: string
  userCode: string
  clientName: string | null
  clientIp: string | null
  userAgent: string | null
  createdAt: string
  expiresAt: string
}

/** A live, unapproved login on this store, for the authorize page. */
export async function findPendingDevice(userCode: string, tenantId: string | null): Promise<PendingDevice | null> {
  const code = normaliseUserCode(userCode)
  if (!code) return null
  const r = await controlPlanePool().query(
    `SELECT id, user_code, client_name, client_ip, user_agent, created_at, expires_at FROM admin_api_tokens
      WHERE user_code = $1 AND tenant_id = $2 AND status = 'pending' AND expires_at > now()`,
    [code, storeTenantId(tenantId)]
  )
  const x = r.rows[0]
  if (!x) return null
  return {
    id: x.id,
    userCode: x.user_code,
    clientName: x.client_name,
    clientIp: x.client_ip,
    userAgent: x.user_agent,
    createdAt: new Date(x.created_at).toISOString(),
    expiresAt: new Date(x.expires_at).toISOString(),
  }
}

export async function approveDeviceAuth(args: {
  userCode: string
  tenantId: string | null
  adminId: string
  adminRole: string
  decision: 'approve' | 'deny'
  scopes: string[]
  ttlSeconds: number
}): Promise<'approved' | 'denied' | 'not_found'> {
  const code = normaliseUserCode(args.userCode)
  if (!code) return 'not_found'
  const approve = args.decision === 'approve'
  const r = await controlPlanePool().query(
    approve
      ? `UPDATE admin_api_tokens SET status = 'active', admin_id = $3, admin_role = $4, scopes = $5::jsonb, approved_at = now(),
                expires_at = now() + make_interval(secs => $6), user_code = NULL
          WHERE user_code = $1 AND tenant_id = $2 AND status = 'pending' AND expires_at > now() RETURNING id`
      : `UPDATE admin_api_tokens SET status = 'denied', admin_id = $3, user_code = NULL
          WHERE user_code = $1 AND tenant_id = $2 AND status = 'pending' AND expires_at > now() RETURNING id`,
    approve
      ? [code, storeTenantId(args.tenantId), args.adminId, args.adminRole.slice(0, 32), JSON.stringify(args.scopes), Math.max(60, Math.floor(args.ttlSeconds))]
      : [code, storeTenantId(args.tenantId), args.adminId]
  )
  if (!r.rows[0]) return 'not_found'
  return approve ? 'approved' : 'denied'
}

// ── Minting outside the device flow ──

/** A person's token minted from a signed-in session (the extension card, `cli/tokens` POST). */
export async function createAdminToken(args: {
  tenantId: string | null
  adminId: string
  adminRole: string
  kind: 'cli' | 'extension'
  scopes: string[]
  ttlSeconds: number
  client: ClientInfo
}): Promise<{ id: string; token: string; prefix: string; expiresAt: string }> {
  const t = newToken(args.kind)
  const r = await controlPlanePool().query<{ id: string; expires_at: string }>(
    `INSERT INTO admin_api_tokens (token_hash, token_prefix, tenant_id, kind, admin_id, admin_role, status, scopes, host, client_name, client_ip, user_agent, approved_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7::jsonb, $8, $9, $10, $11, now(), now() + make_interval(secs => $12))
     RETURNING id, expires_at`,
    [
      t.hash,
      t.prefix,
      storeTenantId(args.tenantId),
      args.kind,
      args.adminId,
      args.adminRole.slice(0, 32),
      JSON.stringify(args.scopes),
      clip(args.client.host, 255),
      clip(args.client.clientName, 120),
      clip(args.client.clientIp, 64),
      clip(args.client.userAgent, 500),
      Math.max(60, Math.floor(args.ttlSeconds)),
    ]
  )
  return { id: r.rows[0].id, token: t.plain, prefix: t.prefix, expiresAt: new Date(r.rows[0].expires_at).toISOString() }
}

/** A service account's key: no expiry, its scopes follow the account's allowed_scopes. */
export async function issueServiceAccountKey(args: {
  tenantId: string | null
  serviceAccountId: string
  name: string
  host: string
}): Promise<{ id: string; token: string; prefix: string }> {
  const t = newToken('service_account')
  const r = await controlPlanePool().query<{ id: string }>(
    `INSERT INTO admin_api_tokens (token_hash, token_prefix, tenant_id, kind, service_account_id, status, scopes, host, client_name, approved_at)
     VALUES ($1, $2, $3, 'service_account', $4, 'active', $5::jsonb, $6, $7, now()) RETURNING id`,
    [t.hash, t.prefix, storeTenantId(args.tenantId), args.serviceAccountId, JSON.stringify([ALL_SCOPES]), clip(args.host, 255), clip(args.name, 120)]
  )
  return { id: r.rows[0].id, token: t.plain, prefix: t.prefix }
}

// ── Resolution ──

export interface ApiTokenRecord {
  id: string
  tenantId: string
  kind: ApiTokenKind
  adminId: string | null
  serviceAccountId: string | null
  adminRole: string | null
  scopes: string[]
  host: string
  expiresAt: string | null
}

/** A live token by its plaintext, or null. `touch: false` leaves last_used_at alone (middleware lookups). */
export async function resolveApiToken(plain: string, opts: { touch?: boolean } = {}): Promise<ApiTokenRecord | null> {
  if (!isApiToken(plain)) return null
  const r = await controlPlanePool().query(
    `SELECT id, tenant_id, kind, admin_id, service_account_id, admin_role, scopes, host, expires_at FROM admin_api_tokens
      WHERE token_hash = $1 AND status = 'active' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [sha256(plain)]
  )
  const x = r.rows[0]
  if (!x) return null
  // The prefix names the holder type; a key never stands in for the other kind.
  if ((x.kind === 'service_account') !== plain.startsWith('jsa_')) return null
  if (opts.touch !== false) {
    void controlPlanePool()
      .query(`UPDATE admin_api_tokens SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`, [x.id])
      .catch(() => {})
  }
  return {
    id: x.id,
    tenantId: x.tenant_id,
    kind: x.kind,
    adminId: x.admin_id,
    serviceAccountId: x.service_account_id,
    adminRole: x.admin_role,
    scopes: Array.isArray(x.scopes) ? x.scopes : [],
    host: x.host,
    expiresAt: x.expires_at ? new Date(x.expires_at).toISOString() : null,
  }
}

// A gateway header names a token the gateway already checked; the store re-checks it is still live (same
// conditions as resolveApiToken) so a revoke applies within LIVE_CACHE_MS, gateway caches or not.
const LIVE_CACHE_MS = 5000
const liveCache = new Map<string, { live: boolean; at: number }>()

export async function isApiTokenLive(id: string, tenantId: string | null): Promise<boolean> {
  const key = `${storeTenantId(tenantId)}:${id}`
  const hit = liveCache.get(key)
  if (hit && Date.now() - hit.at < LIVE_CACHE_MS) return hit.live
  const r = await controlPlanePool().query(
    `SELECT 1 FROM admin_api_tokens
      WHERE id = $1 AND tenant_id = $2 AND status = 'active' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [id, storeTenantId(tenantId)]
  )
  const live = r.rows.length > 0
  if (liveCache.size > 5000) liveCache.clear()
  liveCache.set(key, { live, at: Date.now() })
  return live
}

const forgetLive = () => liveCache.clear()

/** Expiry of a live token, for whoami. */
export async function apiTokenExpiry(id: string): Promise<string | null> {
  const r = await controlPlanePool().query<{ expires_at: string | null }>(`SELECT expires_at FROM admin_api_tokens WHERE id = $1`, [id])
  const e = r.rows[0]?.expires_at
  return e ? new Date(e).toISOString() : null
}

// ── Listing and revocation ──

export interface ApiTokenListItem {
  id: string
  kind: ApiTokenKind
  adminId: string | null
  serviceAccountId: string | null
  status: ApiTokenStatus
  scopes: string[]
  host: string
  clientName: string | null
  clientIp: string | null
  userAgent: string | null
  prefix: string | null
  createdAt: string
  approvedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  lastUsedAt: string | null
  expired: boolean
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)

/** Issued tokens of a store (one admin's, or all of them), live first; revoked ones for 30 days. */
export async function listApiTokens(args: { tenantId: string | null; adminId?: string; serviceAccounts?: boolean }): Promise<ApiTokenListItem[]> {
  const where = [`tenant_id = $1`, `token_hash IS NOT NULL`, `(revoked_at IS NULL OR revoked_at > now() - interval '30 days')`]
  const vals: unknown[] = [storeTenantId(args.tenantId)]
  if (args.adminId) {
    vals.push(args.adminId)
    where.push(`admin_id = $${vals.length}`)
  }
  if (!args.serviceAccounts) where.push(`kind <> 'service_account'`)
  const r = await controlPlanePool().query(
    `SELECT id, kind, admin_id, service_account_id, status, scopes, host, client_name, client_ip, user_agent, token_prefix,
            created_at, approved_at, expires_at, revoked_at, last_used_at, (expires_at IS NOT NULL AND expires_at <= now()) AS expired
       FROM admin_api_tokens WHERE ${where.join(' AND ')}
      ORDER BY (status = 'active' AND (expires_at IS NULL OR expires_at > now())) DESC, created_at DESC LIMIT 500`,
    vals
  )
  return r.rows.map(x => ({
    id: x.id,
    kind: x.kind,
    adminId: x.admin_id,
    serviceAccountId: x.service_account_id,
    status: x.status,
    scopes: Array.isArray(x.scopes) ? x.scopes : [],
    host: x.host,
    clientName: x.client_name,
    clientIp: x.client_ip,
    userAgent: x.user_agent,
    prefix: x.token_prefix,
    createdAt: iso(x.created_at)!,
    approvedAt: iso(x.approved_at),
    expiresAt: iso(x.expires_at),
    revokedAt: iso(x.revoked_at),
    lastUsedAt: iso(x.last_used_at),
    expired: !!x.expired,
  }))
}

/** Revoke one token of the store; with adminId only if it is that admin's own. */
export async function revokeApiToken(args: { id: string; tenantId: string | null; adminId?: string }): Promise<boolean> {
  const vals: unknown[] = [args.id, storeTenantId(args.tenantId)]
  let own = ''
  if (args.adminId) {
    vals.push(args.adminId)
    own = ` AND admin_id = $3`
  }
  const r = await controlPlanePool().query(
    `UPDATE admin_api_tokens SET status = 'revoked', revoked_at = now() WHERE id = $1 AND tenant_id = $2 AND status = 'active'${own} RETURNING id`,
    vals
  )
  forgetLive()
  return !!r.rows[0]
}

/** Every live token a person holds on this store (sign out everywhere, deactivation). */
export async function revokeAllForAdmin(tenantId: string | null, adminId: string): Promise<number> {
  const r = await controlPlanePool().query(
    `UPDATE admin_api_tokens SET status = 'revoked', revoked_at = now()
      WHERE tenant_id = $1 AND admin_id = $2 AND kind <> 'service_account' AND status = 'active'`,
    [storeTenantId(tenantId), adminId]
  )
  forgetLive()
  return r.rowCount ?? 0
}

export async function revokeServiceAccountKeys(tenantId: string | null, serviceAccountId: string): Promise<number> {
  const r = await controlPlanePool().query(
    `UPDATE admin_api_tokens SET status = 'revoked', revoked_at = now()
      WHERE tenant_id = $1 AND service_account_id = $2 AND status = 'active'`,
    [storeTenantId(tenantId), serviceAccountId]
  )
  forgetLive()
  return r.rowCount ?? 0
}
