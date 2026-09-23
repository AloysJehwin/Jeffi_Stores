import crypto from 'crypto'
import { query, queryOne, queryMany } from './db'

// Server-side sessions. The cookie value is a random opaque TOKEN; the DB stores only
// SHA-256(token) in auth_sessions.token_hash and resolveSession() looks it up by that hash —
// so a leaked row/backup is never a usable cookie. auth_sessions.id (the uuid PK) stays as the
// stable UI / revoke handle (listActiveSessions + sessions/[id]/revoke operate on it); the cookie
// token and the row id are DIFFERENT identifiers. resolveSession() is the single source of truth
// used by BOTH the Node-runtime middleware and the Node authenticate* functions. Node-only (uses pg).

export type PrincipalType = 'admin' | 'customer' | 'business' | 'owner'

export const IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000 // 24h of inactivity ends a session (non-admin cap)
export const DEFAULT_ADMIN_IDLE_MINUTES = 8 * 60    // admins with no per-account timeout set
// Allowed per-admin idle timeouts (minutes). Shared with the team-section toggle + the PATCH guard.
export const ADMIN_IDLE_TIMEOUT_CHOICES = [60, 120, 240, 480, 1440] as const
const TOUCH_WINDOW_MS = 5 * 60 * 1000               // only bump last_seen_at every 5 min

// Matches a v4-style uuid. LEGACY: pre-token cookies were the uuid PK itself; resolveSession
// still accepts these during the transition (looked up by id) so existing sessions don't get
// logged out on deploy. Remove the uuid path after one full max-TTL window (>= 7d).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Matches an opaque session token = 32 random bytes as hex (crypto.randomBytes(32)). The cookie
// carries this; the DB stores SHA-256(token). Distinct shape from a uuid so resolveSession can
// route the lookup (token_hash vs legacy id) cheaply before any DB hit.
const TOKEN_RE = /^[0-9a-f]{64}$/i

// SHA-256(token) as lowercase hex — what we store + look up by. Never store the raw token.
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

// Coarse user-agent "family" fingerprint = browser family + OS family, version numbers
// DROPPED on purpose so a routine Chrome/Safari auto-update never forces a re-login. Used
// only to detect a session cookie being replayed from a clearly different browser/device
// (e.g. Chrome/macOS → Safari/iOS, or desktop → mobile). Returns null when the UA can't be
// classified — callers then fail OPEN (never re-auth on an unknown/absent UA).
export function uaFingerprint(ua: string | null | undefined): string | null {
  if (!ua) return null
  const s = ua.toLowerCase()

  // Browser family — order matters (Edge/Chrome both contain "chrome"; iOS browsers all
  // wrap WebKit but identify via CriOS/FxiOS/EdgiOS).
  let browser: string | null = null
  if (s.includes('edg/') || s.includes('edga/') || s.includes('edgios/')) browser = 'edge'
  else if (s.includes('opr/') || s.includes('opera')) browser = 'opera'
  else if (s.includes('samsungbrowser')) browser = 'samsung'
  else if (s.includes('crios/')) browser = 'chrome'
  else if (s.includes('fxios/') || s.includes('firefox')) browser = 'firefox'
  else if (s.includes('chrome') || s.includes('chromium')) browser = 'chrome'
  else if (s.includes('safari')) browser = 'safari'

  // OS / platform family.
  let os: string | null = null
  if (s.includes('iphone') || s.includes('ipad') || s.includes('ipod')) os = 'ios'
  else if (s.includes('android')) os = 'android'
  else if (s.includes('windows')) os = 'windows'
  else if (s.includes('mac os') || s.includes('macintosh')) os = 'macos'
  else if (s.includes('cros')) os = 'chromeos'
  else if (s.includes('linux')) os = 'linux'

  if (!browser && !os) return null
  return `${browser || '?'}|${os || '?'}`
}

// Two UAs "clearly differ" only when BOTH classify to a known family AND those families are
// not equal. If either side is null/unknown we return false (fail open — no forced re-auth).
export function uaClearlyDiffers(storedUA: string | null | undefined, currentUA: string | null | undefined): boolean {
  const a = uaFingerprint(storedUA)
  const b = uaFingerprint(currentUA)
  if (!a || !b) return false
  return a !== b
}

// ---------------------------------------------------------------------------
// Multi-signal device binding. In addition to the UA family above we bind a
// session to a handful of per-request signals so a stolen sid replayed from a
// different environment is caught. Signals split into two categories:
//   STABLE  (ua family, accept-language primary tag, sec-ch-ua-platform) — rarely
//           change for the same physical client; a QUORUM of these differing is the
//           ONLY thing that revokes.
//   SOFT    (ip network, canvas fp hash) — legitimately churn (mobile networks, OS/GPU
//           updates); advisory-only, never revoke on their own.
// Any signal that's null/unclassifiable on EITHER side is dropped (fail open), exactly
// like uaClearlyDiffers. Revoke rule: revoke iff >= 2 STABLE signals clearly differ, so a
// single fuzzy signal (e.g. a proxy rewriting accept-language) never logs a real user out.
// ---------------------------------------------------------------------------

// Per-request signals collected at the edge (see src/lib/session-signals-request.ts).
// All raw — normalization happens inside the helpers below.
export interface SessionSignals {
  // Request context for key binding (see session-binding.ts). Present whenever the signals came
  // from extractSessionSignals(); absent for callers that only pass a bare user-agent.
  binding?: import('./session-binding-shared').BindingContext
  userAgent?: string | null
  acceptLanguage?: string | null // raw Accept-Language header
  uaPlatform?: string | null     // raw Sec-CH-UA-Platform client hint (e.g. '"macOS"')
  ip?: string | null             // raw IP / X-Forwarded-For; derived to a network, never stored raw for binding
  fpHash?: string | null         // client canvas/webgl fingerprint hash
}

// Accept-Language → primary language subtag only. 'en-US,en;q=0.9' → 'en'. Region + q-values
// are DROPPED so en-US ↔ en-GB (browsers reorder region variants) never counts as a diff.
export function langPrimary(al: string | null | undefined): string | null {
  if (!al) return null
  const first = al.split(',')[0]?.split(';')[0]?.trim().toLowerCase()
  if (!first) return null
  const primary = first.split('-')[0]
  return primary || null
}

// Sec-CH-UA-Platform → normalized family. '"macOS"' → 'macos'; strips surrounding quotes and
// lowercases. Absent on non-secure origins / unsupported browsers → null (dropped).
export function normPlatform(p: string | null | undefined): string | null {
  if (!p) return null
  const v = p.replace(/^"+|"+$/g, '').trim().toLowerCase()
  return v || null
}

// Derive a coarse NETWORK from an IP (or the first hop of an X-Forwarded-For list) so a
// user's IP churning within their ISP (mobile, CGNAT, wifi↔LTE) doesn't count as a diff, while
// a genuinely different network (different country/ASN) does. IPv4 → /16 ('a.b'); IPv6 → first
// 3 hextets. NEVER returns the raw IP. Unparseable/null → null.
export function ipNetwork(ip: string | null | undefined): string | null {
  if (!ip) return null
  const first = ip.split(',')[0]?.trim()
  if (!first) return null
  // Strip an IPv6 zone id and a trailing :port on plain IPv4 (not on bracketless IPv6).
  const bare = first.replace(/%.*$/, '')
  if (bare.includes(':')) {
    // IPv6 — first 3 hextets is a coarse network prefix.
    const hextets = bare.split(':').filter(Boolean)
    if (hextets.length < 2) return null
    return hextets.slice(0, 3).join(':').toLowerCase()
  }
  // IPv4 (drop a possible :port that survived above only for v4 dotted form).
  const v4 = bare.replace(/:\d+$/, '')
  const octets = v4.split('.')
  if (octets.length !== 4 || octets.some((o) => o === '' || !/^\d{1,3}$/.test(o) || Number(o) > 255)) {
    return null
  }
  return `${octets[0]}.${octets[1]}`
}

// The snapshot as stored on the session row (already normalized at createSession time).
export interface StoredBinding {
  userAgent: string | null
  acceptLang: string | null
  uaPlatform: string | null
  ipNet: string | null
  fpHash: string | null
}

export interface BindingDecision {
  revoke: boolean
  stableDiffs: number
  softDiffs: number
  reasons: string[]
}

// Conservative, category-gated scorer. Pure (no DB), never throws. Counts a diff only when
// BOTH sides classify to a value (fail open on null). Revoke iff >= 2 STABLE signals differ;
// SOFT signals are recorded for observability but never affect the revoke decision.
export function evaluateBinding(stored: StoredBinding, current: SessionSignals): BindingDecision {
  const reasons: string[] = []
  let stableDiffs = 0
  let softDiffs = 0

  // STABLE — user-agent family (reuses the existing fail-open helper).
  if (uaClearlyDiffers(stored.userAgent, current.userAgent)) {
    stableDiffs++
    reasons.push('ua')
  }
  // STABLE — accept-language primary subtag.
  const curLang = langPrimary(current.acceptLanguage)
  if (stored.acceptLang && curLang && stored.acceptLang !== curLang) {
    stableDiffs++
    reasons.push('accept-language')
  }
  // STABLE — sec-ch-ua-platform.
  const curPlatform = normPlatform(current.uaPlatform)
  if (stored.uaPlatform && curPlatform && stored.uaPlatform !== curPlatform) {
    stableDiffs++
    reasons.push('ua-platform')
  }

  // SOFT — ip network (advisory only).
  const curNet = ipNetwork(current.ip)
  if (stored.ipNet && curNet && stored.ipNet !== curNet) {
    softDiffs++
    reasons.push('ip-net')
  }
  // SOFT — canvas fingerprint hash (advisory only).
  if (stored.fpHash && current.fpHash && stored.fpHash !== current.fpHash) {
    softDiffs++
    reasons.push('fp-hash')
  }

  return { revoke: stableDiffs >= 2, stableDiffs, softDiffs, reasons }
}

export interface AuthSessionRow {
  id: string
  principal_type: PrincipalType
  principal_id: string
  created_at: string
  last_seen_at: string
  expires_at: string
  revoked_at: string | null
  user_agent: string | null
  ip_address: string | null
  accept_lang: string | null
  ua_platform: string | null
  ip_net: string | null
  fp_hash: string | null
}

// The resolved principal for a live session — everything the middleware + authenticate*
// functions need. Security fields (role/scopes/certCN/approvalStatus) are snapshotted on
// the session row at login; email/displayName are joined fresh from admins/users.
export interface ResolvedSession {
  sid: string
  principalType: PrincipalType
  principalId: string
  role: string | null
  scopes: string[]
  certCN: string | null
  approvalStatus: string | null
  tenantId: string | null
  email: string | null
  displayName: string | null
  expiresAt: string
}

// Create a session row at login/signup. Generates a random opaque token (the cookie value) and
// stores only its SHA-256 in token_hash — the raw token is never persisted. Returns the token as
// `sid` (what callers set the cookie to) plus the row `id` (the stable UI/revoke handle).
// Device-binding signals are normalized here (langPrimary/normPlatform/ipNetwork) so the stored
// snapshot is directly comparable per-request; raw ip is kept in ip_address for display.
export async function createSession(args: {
  principalType: PrincipalType
  principalId: string
  ttlSeconds: number
  userAgent?: string | null
  ip?: string | null
  role?: string | null
  scopes?: string[] | null
  certCN?: string | null
  approvalStatus?: string | null
  tenantId?: string | null
  acceptLanguage?: string | null
  uaPlatform?: string | null
  fpHash?: string | null
}): Promise<{ sid: string; id: string; expiresAt: string }> {
  const expiresAt = new Date(Date.now() + args.ttlSeconds * 1000).toISOString()
  const token = crypto.randomBytes(32).toString('hex')
  const row = await queryOne<{ id: string }>(
    `INSERT INTO auth_sessions
       (principal_type, principal_id, expires_at, user_agent, ip_address, role, scopes, cert_cn, approval_status,
        tenant_id, accept_lang, ua_platform, ip_net, fp_hash, token_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING id`,
    [
      args.principalType, args.principalId, expiresAt,
      args.userAgent || null, args.ip || null,
      args.role || null, JSON.stringify(args.scopes || []),
      args.certCN || null, args.approvalStatus || null,
      args.tenantId || null,
      langPrimary(args.acceptLanguage), normPlatform(args.uaPlatform), ipNetwork(args.ip),
      args.fpHash || null, hashToken(token),
    ]
  )
  if (!row) throw new Error('Failed to create session')
  return { sid: token, id: row.id, expiresAt }
}

// Hot path: resolve an opaque session token to its live principal, or null if the token has a
// bad shape / no row / revoked / past absolute expiry / idle-expired. The cookie carries a random
// token → look up by token_hash = SHA-256(token). LEGACY: a pre-token uuid cookie is looked up by
// id (transition; removable after one max-TTL window). `current` accepts EITHER a bare user-agent
// string (legacy callers) OR a SessionSignals object (multi-signal binding) — a string is
// normalized to { userAgent }. When signals are supplied and evaluateBinding() decides the session
// is being replayed from a clearly different environment (>= 2 STABLE signals differ), the session
// is REVOKED and null returned. On success, throttled fire-and-forget last_seen_at touch (never
// awaited). email/displayName joined fresh: admins.user_id → users for admin; principal_id → users
// for customer/business.
/**
 * A tenant admin may hold more scopes than its plan sells — provisioning grants a fixed set,
 * and a plan change must take effect without re-provisioning. Intersecting here means every
 * consumer (middleware, authenticateAdmin, server components) sees the entitled set.
 *
 * Fails CLOSED on lookup error or an empty plan: falls back to the safe-core scopes (intersected
 * with what was granted), never the full grant. A control-plane blip must not silently expose
 * feature pages a plan never bought; it only keeps the shell + settings reachable.
 */
async function effectiveScopes(tenantId: string | null, granted: string[], role: string | null): Promise<string[]> {
  if (!tenantId || granted.length === 0) return granted
  try {
    const { getTenantPlan } = await import('./plan-gate')
    const { SAFE_CORE_SCOPE_KEYS, SUPER_ROLES, TENANT_SCOPE_KEYS } = await import('./scopes')
    const { scopes } = await getTenantPlan(tenantId)
    if (scopes.size === 0) return granted.filter(s => SAFE_CORE_SCOPE_KEYS.includes(s))
    // A tenant OWNER's grant is a snapshot of the plan at provisioning time. Derive it from the
    // plan live instead, so a scope added to their plan later (or a plan change) takes effect
    // without re-provisioning. Team members keep the scopes the owner explicitly assigned.
    if (role && (SUPER_ROLES as readonly string[]).includes(role)) {
      return TENANT_SCOPE_KEYS.filter(s => scopes.has(s))
    }
    return granted.filter(s => scopes.has(s))
  } catch {
    const { SAFE_CORE_SCOPE_KEYS } = await import('./scopes')
    return granted.filter(s => SAFE_CORE_SCOPE_KEYS.includes(s))
  }
}

export async function resolveSession(sid: string, current?: string | null | SessionSignals): Promise<ResolvedSession | null> {
  if (!sid) return null
  // Route the lookup by cookie shape (cheap, pre-DB): token → token_hash; legacy uuid → id.
  let whereCol: 'token_hash' | 'id'
  let lookupValue: string
  if (TOKEN_RE.test(sid)) {
    whereCol = 'token_hash'
    lookupValue = hashToken(sid)
  } else if (UUID_RE.test(sid)) {
    whereCol = 'id'
    lookupValue = sid
  } else {
    return null
  }
  const row = await queryOne<{
    id: string
    principal_type: PrincipalType; principal_id: string
    revoked_at: string | null; expires_at: string; last_seen_at: string; created_at: string | null
    idle_timeout_minutes: number | null
    role: string | null; scopes: any; cert_cn: string | null; approval_status: string | null
    tenant_id: string | null
    user_agent: string | null; accept_lang: string | null; ua_platform: string | null
    ip_net: string | null; fp_hash: string | null
    email: string | null; first_name: string | null; last_name: string | null
  }>(
    `SELECT s.id, s.principal_type, s.principal_id, s.revoked_at, s.expires_at, s.last_seen_at, s.created_at,
            s.role, s.scopes, s.cert_cn, s.approval_status, s.tenant_id, s.user_agent,
            s.accept_lang, s.ua_platform, s.ip_net, s.fp_hash,
            a.idle_timeout_minutes,
            u.email, u.first_name, u.last_name
     FROM auth_sessions s
     LEFT JOIN admins a ON a.id = s.principal_id AND s.principal_type = 'admin'
     LEFT JOIN users u ON u.id = COALESCE(a.user_id, s.principal_id)
     WHERE s.${whereCol} = $1`,
    [lookupValue]
  )
  if (!row) return null
  if (row.revoked_at) return null
  const now = Date.now()
  if (new Date(row.expires_at).getTime() <= now) return null
  // Idle window: admins use their per-account timeout (or the admin default); everyone else the
  // 24h cap. Enforced here on every request, so a session idle past the window is refused even if
  // the browser was closed — a returning admin lands on the login page.
  const idleWindowMs = row.principal_type === 'admin'
    ? (row.idle_timeout_minutes ?? DEFAULT_ADMIN_IDLE_MINUTES) * 60_000
    : IDLE_TIMEOUT_MS
  if (now - new Date(row.last_seen_at).getTime() > idleWindowMs) return null

  // Device binding: score the presented signals against the login-time snapshot. A clear
  // replay (>= 2 STABLE signals differ) revokes the whole session (fire-and-forget) and
  // rejects. Fails open when signals are absent/unclassifiable (see evaluateBinding). A bare
  // string is treated as { userAgent } for back-compat with legacy callers.
  if (current !== undefined) {
    const sig: SessionSignals = typeof current === 'object' && current !== null ? current : { userAgent: current }
    const decision = evaluateBinding(
      {
        userAgent: row.user_agent,
        acceptLang: row.accept_lang,
        uaPlatform: row.ua_platform,
        ipNet: row.ip_net,
        fpHash: row.fp_hash,
      },
      sig
    )
    if (decision.revoke) {
      query(`UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [row.id]).catch(() => {})
      return null
    }

    // Key binding: the passive signals above cannot tell two windows of the same browser apart,
    // so a copied cookie passes them. Any failure in here fails open — it must never break auth.
    if (sig.binding) {
      try {
        const { evaluateKeyBinding } = await import('./session-binding')
        const verdict = await evaluateKeyBinding({
          sessionId: row.id,
          sidHash: lookupValue,
          principalType: row.principal_type,
          ctx: sig.binding,
          sessionCreatedAt: row.created_at ? new Date(row.created_at).getTime() : null,
        })
        if (verdict.reject) return null
      } catch { /* fail open */ }
    }
  }

  if (now - new Date(row.last_seen_at).getTime() > TOUCH_WINDOW_MS) {
    query(`UPDATE auth_sessions SET last_seen_at = now() WHERE id = $1`, [row.id]).catch(() => {})
  }

  const displayName = `${row.first_name || ''} ${row.last_name || ''}`.trim() || null
  const granted: string[] = Array.isArray(row.scopes) ? row.scopes : []
  return {
    sid,
    principalType: row.principal_type,
    principalId: row.principal_id,
    role: row.role,
    scopes: await effectiveScopes(row.tenant_id, granted, row.role),
    certCN: row.cert_cn,
    approvalStatus: row.approval_status,
    tenantId: row.tenant_id,
    email: row.email,
    displayName,
    expiresAt: new Date(row.expires_at).toISOString(),
  }
}

// Thin wrapper over resolveSession — one liveness implementation, no drift.
export async function validateSession(sid: string, principalType: PrincipalType, current?: string | null | SessionSignals): Promise<boolean> {
  const s = await resolveSession(sid, current)
  return !!s && s.principalType === principalType
}

// Map a cookie value OR a session row id to the column + value used to find its row: a token →
// (token_hash, hash); a uuid → (id, uuid). Returns null for a malformed value. Shared by
// extend/revoke. NOTE: the uuid → id branch is NOT purely legacy here — the active-sessions UI
// revokes by the row id (sessions/[id]/revoke passes a uuid), so this branch is permanent even
// after resolveSession's legacy-cookie path is removed. Do not delete it.
function cookieMatch(sid: string): { col: 'token_hash' | 'id'; value: string } | null {
  if (TOKEN_RE.test(sid)) return { col: 'token_hash', value: hashToken(sid) }
  if (UUID_RE.test(sid)) return { col: 'id', value: sid }
  return null
}

// Slide the absolute expiry forward (session "refresh"). Keeps the same cookie value. Only
// touches live sessions. `sid` is the cookie value (token, or legacy uuid).
export async function extendSession(sid: string, ttlSeconds: number): Promise<void> {
  if (!sid) return
  const match = cookieMatch(sid)
  if (!match) return
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()
  await query(
    `UPDATE auth_sessions SET expires_at = $2, last_seen_at = now()
     WHERE ${match.col} = $1 AND revoked_at IS NULL`,
    [match.value, expiresAt]
  )
}

// Revoke a single session by its cookie value (token, or legacy uuid). Used by logout.
export async function revokeSession(sid: string): Promise<void> {
  if (!sid) return
  const match = cookieMatch(sid)
  if (!match) return
  await query(
    `UPDATE auth_sessions SET revoked_at = now() WHERE ${match.col} = $1 AND revoked_at IS NULL`,
    [match.value]
  )
}

// "Log out everywhere" / admin force-logout of an account.
export async function revokeAllForPrincipal(principalType: PrincipalType, principalId: string): Promise<number> {
  const res = await query(
    `UPDATE auth_sessions SET revoked_at = now()
     WHERE principal_type = $1 AND principal_id = $2 AND revoked_at IS NULL`,
    [principalType, principalId]
  )
  return res.rowCount || 0
}

// Active (non-revoked, non-expired) sessions for the "active sessions" UI.
export async function listActiveSessions(principalType: PrincipalType, principalId: string): Promise<AuthSessionRow[]> {
  return queryMany<AuthSessionRow>(
    `SELECT id, principal_type, principal_id, created_at, last_seen_at, expires_at, revoked_at,
            user_agent, ip_address, accept_lang, ua_platform, ip_net, fp_hash
     FROM auth_sessions
     WHERE principal_type = $1 AND principal_id = $2
       AND revoked_at IS NULL AND expires_at > now()
     ORDER BY last_seen_at DESC`,
    [principalType, principalId]
  )
}
