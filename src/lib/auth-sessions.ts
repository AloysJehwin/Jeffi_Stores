import { query, queryOne, queryMany } from './db'

// Server-side revocable sessions backing the JWT `sid` claim. Node-only (uses pg).
// Enforced in the Node layer (jwt.ts authenticate*), not in Edge middleware.

export type PrincipalType = 'admin' | 'customer' | 'business'

export const IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000 // 24h of inactivity ends a session
const TOUCH_WINDOW_MS = 5 * 60 * 1000               // only bump last_seen_at every 5 min

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

// Create a session row at login/signup. Returns the sid to embed in the JWT.
export async function createSession(args: {
  principalType: PrincipalType
  principalId: string
  ttlSeconds: number
  userAgent?: string | null
  ip?: string | null
}): Promise<{ sid: string; expiresAt: string }> {
  const expiresAt = new Date(Date.now() + args.ttlSeconds * 1000).toISOString()
  const row = await queryOne<{ id: string }>(
    `INSERT INTO auth_sessions (principal_type, principal_id, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [args.principalType, args.principalId, expiresAt, args.userAgent || null, args.ip || null]
  )
  if (!row) throw new Error('Failed to create session')
  return { sid: row.id, expiresAt }
}

// Hot path: validate a session by sid. Rejects if missing / wrong principal type /
// revoked / past absolute expiry / idle-expired. On success, throttled fire-and-forget
// touch of last_seen_at (never awaited on the request critical path).
export async function validateSession(sid: string, principalType: PrincipalType): Promise<boolean> {
  if (!sid) return false
  const row = await queryOne<{ revoked_at: string | null; expires_at: string; last_seen_at: string }>(
    `SELECT revoked_at, expires_at, last_seen_at
     FROM auth_sessions
     WHERE id = $1 AND principal_type = $2`,
    [sid, principalType]
  )
  if (!row) return false
  if (row.revoked_at) return false
  const now = Date.now()
  if (new Date(row.expires_at).getTime() <= now) return false
  if (now - new Date(row.last_seen_at).getTime() > IDLE_TIMEOUT_MS) return false

  // Throttled liveness touch — fire-and-forget, never blocks the request.
  if (now - new Date(row.last_seen_at).getTime() > TOUCH_WINDOW_MS) {
    query(`UPDATE auth_sessions SET last_seen_at = now() WHERE id = $1`, [sid]).catch(() => {})
  }
  return true
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
