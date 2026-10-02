import crypto from 'crypto'
import { query, queryOne } from '@/lib/shared/db'
import type { PrincipalType } from '@/lib/auth/auth-sessions'
import { getCookieDomain } from '@/lib/auth/cookie-domain'
import {
  BIND_ENDPOINT,
  BIND_TTL_S,
  PROOF_EXEMPT_PATHS,
  bindScope,
  type BindingContext,
} from '@/lib/auth/session-binding-shared'

export {
  BIND_ENDPOINT,
  PROOF_HEADER,
  BIND_TTL_S,
  BIND_COOKIE,
  bindScope,
  normHost,
  type BindingContext,
} from '@/lib/auth/session-binding-shared'

// Key-bound sessions. A session cookie is a bearer token: copied into another browser it still
// works, and no passive signal can tell two windows of the same browser apart. So the session is
// also tied to a signing key the login browser holds as NON-EXTRACTABLE (it cannot be exported,
// even from DevTools). Three values are needed together, and only the first looks like a session:
//   1. the *_sid cookie            long-lived session id
//   2. a short-lived cookie        minted only after the browser proves it holds the key
//   3. a signed header per API call
// A copied *_sid alone is useless; a full copied cookie jar dies within BIND_TTL_S and cannot be
// renewed; fetch/XHR API calls fail at once because they need (3).

export type BindingMode = 'off' | 'monitor' | 'enforce'

const PROOF_SKEW_MS = 120_000
const KEY_CACHE_TTL_MS = 5 * 60_000
const LOG_THROTTLE_MS = 10 * 60_000
// A key can only be attached to a young session. Without this, whoever presents an old, never
// bound *_sid first (the thief) would register their own key and lock the real user out.
const REGISTRATION_WINDOW_MS = 10 * 60_000
// Requests already in flight when the key is registered cannot carry the cookie it earns.
const POST_REGISTRATION_GRACE_MS = 15_000
const TOKEN_RE = /^[0-9a-f]{64}$/i

function secretBase(): string {
  return process.env.SESSION_BINDING_SECRET || process.env.JWT_SECRET || process.env.CRON_SECRET || ''
}

// monitor (default) records what would be refused and refuses nothing. With no server secret the
// short-lived cookie could be forged, so binding switches itself off rather than pretend.
export function bindingMode(): BindingMode {
  if (!secretBase()) return 'off'
  const v = (process.env.SESSION_BINDING_MODE || 'monitor').toLowerCase()
  return v === 'off' || v === 'enforce' ? v : 'monitor'
}

export function sidHashOf(sid: string): string {
  return TOKEN_RE.test(sid) ? crypto.createHash('sha256').update(sid).digest('hex') : sid
}

export function canRegisterKey(sessionCreatedAtMs: number | null | undefined): boolean {
  if (bindingMode() !== 'enforce') return true
  return typeof sessionCreatedAtMs === 'number' && Date.now() - sessionCreatedAtMs <= REGISTRATION_WINDOW_MS
}

// A stored key's host matches a request when the request's bind scope equals what was stored. Also
// accept a legacy row whose bind_host is a full host under the scope (keys registered before binding
// moved to domain scope) — so a rollout does not invalidate every live session. Both sides are
// collapsed to the shared cookie domain where applicable (see bindScope).
function hostInScope(storedHost: string, requestHost: string): boolean {
  const cookieDomain = getCookieDomain()
  const scope = bindScope(requestHost, cookieDomain)
  return bindScope(storedHost, cookieDomain) === scope
}

function macKey(): Buffer {
  return crypto
    .createHash('sha256')
    .update('session-binding:' + secretBase())
    .digest()
}

function mac(sidHash: string, exp: number, host: string): string {
  return crypto.createHmac('sha256', macKey()).update(`${sidHash}|${exp}|${host}`).digest('base64url')
}

// Stateless: verifying it needs no database read, and it only verifies next to the exact *_sid
// and the bind SCOPE it was minted for (the shared cookie domain, so one cookie covers apex + every
// subdomain the *_sid is sent to; see bindScope).
export function mintBindCookie(sidHash: string, host: string): { value: string; exp: number } {
  const exp = Math.floor(Date.now() / 1000) + BIND_TTL_S
  return { value: `${exp.toString(36)}.${mac(sidHash, exp, bindScope(host, getCookieDomain()))}`, exp }
}

export function verifyBindCookie(value: string | null | undefined, sidHash: string, host: string): boolean {
  if (!value) return false
  const dot = value.indexOf('.')
  if (dot < 1) return false
  const exp = parseInt(value.slice(0, dot), 36)
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false
  const expected = Buffer.from(mac(sidHash, exp, bindScope(host, getCookieDomain())))
  const given = Buffer.from(value.slice(dot + 1))
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
}

export interface PublicJwk {
  kty: 'EC'
  crv: 'P-256'
  x: string
  y: string
}

export function parsePublicJwk(input: unknown): PublicJwk | null {
  const j = input as Record<string, unknown> | null
  if (!j || j.kty !== 'EC' || j.crv !== 'P-256' || 'd' in j) return null
  if (typeof j.x !== 'string' || typeof j.y !== 'string') return null
  if (!/^[A-Za-z0-9_-]{43}$/.test(j.x) || !/^[A-Za-z0-9_-]{43}$/.test(j.y)) return null
  return { kty: 'EC', crv: 'P-256', x: j.x, y: j.y }
}

// Proof = "<ts base36>.<nonce>.<sig>", an ECDSA P-256 signature (WebCrypto's raw r||s form) over
// METHOD, path, ts and nonce.
export function verifyProof(
  jwk: PublicJwk,
  proof: string | null | undefined,
  method: string,
  path: string
): { ok: boolean; ts: number } {
  const parts = String(proof ?? '').split('.')
  if (parts.length !== 3) return { ok: false, ts: 0 }
  const ts = parseInt(parts[0], 36)
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > PROOF_SKEW_MS) return { ok: false, ts: 0 }
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(parts[1])) return { ok: false, ts }
  try {
    const key = crypto.createPublicKey({ key: jwk as unknown as crypto.JsonWebKey, format: 'jwk' })
    const message = Buffer.from(`${method.toUpperCase()}\n${path}\n${ts}\n${parts[1]}`)
    const ok = crypto.verify('sha256', message, { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url'))
    return { ok, ts }
  } catch {
    return { ok: false, ts }
  }
}

interface StoredKey {
  jwk: PublicJwk
  host: string
  createdAt: number
}
const keyCache = new Map<string, { key: StoredKey; at: number }>()

// 'unavailable' = the table could not be read (a database the schema has not reached yet).
// Callers must then skip binding entirely: storage we cannot read must never lock anyone out.
export async function loadSessionKey(sessionId: string): Promise<StoredKey | null | 'unavailable'> {
  const hit = keyCache.get(sessionId)
  if (hit && Date.now() - hit.at < KEY_CACHE_TTL_MS) return hit.key
  try {
    const row = await queryOne<{ public_jwk: unknown; bind_host: string; created_at: string }>(
      `SELECT public_jwk, bind_host, created_at FROM auth_session_keys WHERE session_id = $1`,
      [sessionId]
    )
    if (!row) return null
    const jwk = parsePublicJwk(row.public_jwk)
    if (!jwk) return null
    const key = { jwk, host: row.bind_host, createdAt: new Date(row.created_at).getTime() }
    if (keyCache.size > 5000) keyCache.clear()
    keyCache.set(sessionId, { key, at: Date.now() })
    return key
  } catch {
    return 'unavailable'
  }
}

// First registration wins; the key is immutable for the life of the session.
export async function registerSessionKey(sessionId: string, jwk: PublicJwk, host: string): Promise<StoredKey | null> {
  await query(
    `INSERT INTO auth_session_keys (session_id, public_jwk, bind_host) VALUES ($1, $2, $3)
     ON CONFLICT (session_id) DO NOTHING`,
    [sessionId, JSON.stringify(jwk), bindScope(host, getCookieDomain())]
  )
  keyCache.delete(sessionId)
  const stored = await loadSessionKey(sessionId)
  return stored === 'unavailable' ? null : stored
}

// A renewal is accepted once: its timestamp must be newer than the last accepted one, so a
// request copied out of the network tab cannot be replayed to mint another cookie.
export async function consumeRefresh(sessionId: string, ts: number): Promise<boolean> {
  const row = await queryOne<{ session_id: string }>(
    `UPDATE auth_session_keys SET last_refresh_ts = $2, updated_at = now()
      WHERE session_id = $1 AND last_refresh_ts < $2 RETURNING session_id`,
    [sessionId, ts]
  )
  return !!row
}

export interface BindingVerdict {
  status: 'ok' | 'skipped' | 'unbound' | 'violation'
  reason?: string
  reject: boolean
}

const lastLogged = new Map<string, number>()

export function logBinding(event: Record<string, unknown> & { sessionId: string; reason: string }): void {
  const k = `${event.sessionId}:${event.reason}`
  const now = Date.now()
  if (now - (lastLogged.get(k) ?? 0) < LOG_THROTTLE_MS) return
  if (lastLogged.size > 5000) lastLogged.clear()
  lastLogged.set(k, now)
  const payload = JSON.stringify({ ...event, mode: bindingMode(), at: new Date(now).toISOString() })
  console.warn('[session-binding]', payload)
  query(`INSERT INTO _debug_log (source, payload) VALUES ($1, $2)`, ['session-binding', payload]).catch(() => {})
}

export async function evaluateKeyBinding(args: {
  sessionId: string
  sidHash: string
  principalType: PrincipalType
  ctx: BindingContext
  sessionCreatedAt?: number | null
}): Promise<BindingVerdict> {
  const mode = bindingMode()
  const { ctx, sessionId, sidHash, principalType } = args
  // The bind endpoint authenticates the key itself; judging it here would be circular.
  if (mode === 'off' || ctx.path === BIND_ENDPOINT) return { status: 'skipped', reject: false }

  const cookieVal = ctx.bindCookies[principalType] ?? null
  // Only script-made mutations owe a proof. Reads (every portal's page-load /me probe) must never
  // reject, or the reload loses the bind race and logs the user out.
  const isRead = ctx.method === 'GET' || ctx.method === 'HEAD'
  const proofRequired =
    ctx.path.startsWith('/api/') &&
    ctx.fetchDest === 'empty' &&
    !isRead &&
    !PROOF_EXEMPT_PATHS.has(ctx.path)

  let reason: string | null = null
  let key: StoredKey | null | 'unavailable' | undefined
  if (!verifyBindCookie(cookieVal, sidHash, ctx.host)) {
    reason = cookieVal ? 'cookie_invalid' : 'cookie_missing'
  } else if (proofRequired) {
    key = await loadSessionKey(sessionId)
    if (key === 'unavailable' || !key) return { status: 'skipped', reject: false }
    if (!ctx.proof) reason = 'proof_missing'
    else if (!verifyProof(key.jwk, ctx.proof, ctx.method, ctx.path).ok) reason = 'proof_invalid'
  }
  if (!reason) return { status: 'ok', reject: false }

  if (key === undefined) key = await loadSessionKey(sessionId)
  if (key === 'unavailable') return { status: 'skipped', reject: false }
  if (!key) {
    // No key yet: a login that has not bound since, or a session older than this feature. Only a
    // proof-required request (a script-made API call) is rejected under enforcement. A top-level
    // document navigation is NEVER rejected here: its request is judged before any page JS can
    // (re)bind, and the bind cookie is short-lived (BIND_TTL_S), so rejecting a reload logged
    // active storefront users out. Binding guards authenticated API mutations, not page views.
    const expired = mode === 'enforce' && proofRequired && !canRegisterKey(args.sessionCreatedAt)
    logBinding({
      sessionId,
      principalType,
      reason: expired ? 'unbound_expired' : 'unbound',
      path: ctx.path,
      host: ctx.host,
    })
    return { status: 'unbound', reject: expired }
  }
  if (!hostInScope(key.host, ctx.host)) reason = 'host_mismatch'

  // abs(): a key timestamp in the future (clock skew) must not read as a grace that never ends.
  const inGrace =
    (reason === 'cookie_missing' || reason === 'cookie_invalid') &&
    Math.abs(Date.now() - key.createdAt) < POST_REGISTRATION_GRACE_MS
  if (inGrace) return { status: 'ok', reject: false }

  logBinding({
    sessionId,
    principalType,
    reason,
    path: ctx.path,
    host: ctx.host,
    boundHost: key.host,
    fetchDest: ctx.fetchDest,
  })
  // Reject ONLY proof-required script API calls. A document navigation / page load with a missing,
  // stale or wrong bind cookie must pass: the reload's document request is evaluated before the
  // client can re-bind, and the cookie expires every BIND_TTL_S, so rejecting here is exactly what
  // logged active users out on reload. A copied cookie is still blocked the moment it attempts an
  // authenticated API mutation (proofRequired), which is binding's actual purpose.
  return { status: 'violation', reason, reject: mode === 'enforce' && proofRequired }
}
