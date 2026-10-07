import crypto from 'crypto'
import { query, queryOne } from '@/lib/shared/db'
import type { PrincipalType } from '@/lib/auth/auth-sessions'

// Single-use store→vault handoff. Only the SHA-256 of the token is stored (tenant DB), so a ticket
// can't be replayed from a leaked row or on another tenant.

export type TicketPrincipal = Extract<PrincipalType, 'customer' | 'business'>

export const TICKET_TTL_S = 120
export const DEFAULT_VAULT_PATH = '/library'
export const STATE_COOKIE = 'vault_state'
const TOKEN_RE = /^[0-9a-f]{64}$/i

/** The vault host's per-browser handoff state: 64 hex chars. */
export function isValidState(state: string | null | undefined): state is string {
  return !!state && TOKEN_RE.test(state)
}

export function hashTicket(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Relative vault path only — no scheme, host, protocol-relative or backslash prefix (no open redirect). */
export function isSafeTargetPath(path: string | null | undefined): path is string {
  if (!path || path.length > 512) return false
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return false
  if (/[\x00-\x1f\\]/.test(path)) return false
  return !/^[a-z][a-z0-9+.-]*:/i.test(path)
}

export function safeTargetPath(path: string | null | undefined): string {
  return isSafeTargetPath(path) ? path : DEFAULT_VAULT_PATH
}

export async function mintVaultTicket(args: {
  userId: string
  principalType: TicketPrincipal
  targetPath: string
  /** The vault_state value the vault host set in this browser (required, see isValidState). */
  state: string
}): Promise<{ token: string }> {
  if (!isValidState(args.state)) throw new Error('invalid vault handoff state')
  const token = crypto.randomBytes(32).toString('hex')
  await query(
    `INSERT INTO vault_tickets (ticket_hash, user_id, principal_type, target_path, state_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6::double precision))`,
    [
      hashTicket(token),
      args.userId,
      args.principalType,
      safeTargetPath(args.targetPath),
      hashTicket(args.state.toLowerCase()),
      TICKET_TTL_S,
    ]
  )
  return { token }
}

export interface ConsumedTicket {
  userId: string
  principalType: TicketPrincipal
  targetPath: string
}

/**
 * Atomically burns an unused, unexpired ticket whose state matches this browser's vault_state cookie;
 * replays, expired tickets and tickets started in another browser return null.
 */
export async function consumeVaultTicket(token: string, state: string | null | undefined): Promise<ConsumedTicket | null> {
  if (!TOKEN_RE.test(token) || !isValidState(state)) return null
  const row = await queryOne<{ user_id: string; principal_type: string; target_path: string | null }>(
    `UPDATE vault_tickets SET used_at = now()
       WHERE ticket_hash = $1 AND state_hash = $2 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id, principal_type, target_path`,
    [hashTicket(token.toLowerCase()), hashTicket(state.toLowerCase())]
  )
  if (!row || (row.principal_type !== 'customer' && row.principal_type !== 'business')) return null
  return { userId: row.user_id, principalType: row.principal_type, targetPath: safeTargetPath(row.target_path) }
}
