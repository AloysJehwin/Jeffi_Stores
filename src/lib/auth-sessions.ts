import { query, queryOne, queryMany } from './db'

// Server-side sessions. The session id (auth_sessions.id) IS the opaque cookie value —
// no JWT. resolveSession() is the single source of truth used by BOTH the Node-runtime
// middleware and the Node authenticate* functions. Node-only (uses pg).

export type PrincipalType = 'admin' | 'customer' | 'business'

export const IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000 // 24h of inactivity ends a session
const TOUCH_WINDOW_MS = 5 * 60 * 1000               // only bump last_seen_at every 5 min

// Matches a v4-style uuid; used to reject legacy signed-JWT cookies ("eyJ...") cheaply
// before any DB hit.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  email: string | null
  displayName: string | null
}

// Create a session row at login/signup. Returns the opaque sid = the cookie value.
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
}): Promise<{ sid: string; expiresAt: string }> {
  const expiresAt = new Date(Date.now() + args.ttlSeconds * 1000).toISOString()
  const row = await queryOne<{ id: string }>(
    `INSERT INTO auth_sessions
       (principal_type, principal_id, expires_at, user_agent, ip_address, role, scopes, cert_cn, approval_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      args.principalType, args.principalId, expiresAt,
      args.userAgent || null, args.ip || null,
      args.role || null, JSON.stringify(args.scopes || []),
      args.certCN || null, args.approvalStatus || null,
    ]
  )
  if (!row) throw new Error('Failed to create session')
  return { sid: row.id, expiresAt }
}

// Hot path: resolve an opaque session id to its live principal, or null if the sid isn't
// a uuid / no row / revoked / past absolute expiry / idle-expired. On success, throttled
// fire-and-forget last_seen_at touch (never awaited). email/displayName joined fresh:
// admins.user_id → users for admin; principal_id → users for customer/business.
export async function resolveSession(sid: string): Promise<ResolvedSession | null> {
  if (!sid || !UUID_RE.test(sid)) return null
  const row = await queryOne<{
    principal_type: PrincipalType; principal_id: string
    revoked_at: string | null; expires_at: string; last_seen_at: string
    role: string | null; scopes: any; cert_cn: string | null; approval_status: string | null
    email: string | null; first_name: string | null; last_name: string | null
  }>(
    `SELECT s.principal_type, s.principal_id, s.revoked_at, s.expires_at, s.last_seen_at,
            s.role, s.scopes, s.cert_cn, s.approval_status,
            u.email, u.first_name, u.last_name
     FROM auth_sessions s
     LEFT JOIN admins a ON a.id = s.principal_id AND s.principal_type = 'admin'
     LEFT JOIN users u ON u.id = COALESCE(a.user_id, s.principal_id)
     WHERE s.id = $1`,
    [sid]
  )
  if (!row) return null
  if (row.revoked_at) return null
  const now = Date.now()
  if (new Date(row.expires_at).getTime() <= now) return null
  if (now - new Date(row.last_seen_at).getTime() > IDLE_TIMEOUT_MS) return null

  if (now - new Date(row.last_seen_at).getTime() > TOUCH_WINDOW_MS) {
    query(`UPDATE auth_sessions SET last_seen_at = now() WHERE id = $1`, [sid]).catch(() => {})
  }

  const displayName = `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email || null
  return {
    sid,
    principalType: row.principal_type,
    principalId: row.principal_id,
    role: row.role,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    certCN: row.cert_cn,
    approvalStatus: row.approval_status,
    email: row.email,
    displayName,
  }
}

// Thin wrapper over resolveSession — one liveness implementation, no drift.
export async function validateSession(sid: string, principalType: PrincipalType): Promise<boolean> {
  const s = await resolveSession(sid)
  return !!s && s.principalType === principalType
}

// Slide the absolute expiry forward (session "refresh"). Keeps the same sid — the cookie
// value never changes. Only touches live sessions.
export async function extendSession(sid: string, ttlSeconds: number): Promise<void> {
  if (!sid) return
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()
  await query(
    `UPDATE auth_sessions SET expires_at = $2, last_seen_at = now()
     WHERE id = $1 AND revoked_at IS NULL`,
    [sid, expiresAt]
  )
}

export async function revokeSession(sid: string): Promise<void> {
  if (!sid) return
  await query(
    `UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
    [sid]
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
    `SELECT id, principal_type, principal_id, created_at, last_seen_at, expires_at, revoked_at, user_agent, ip_address
     FROM auth_sessions
     WHERE principal_type = $1 AND principal_id = $2
       AND revoked_at IS NULL AND expires_at > now()
     ORDER BY last_seen_at DESC`,
    [principalType, principalId]
  )
}
