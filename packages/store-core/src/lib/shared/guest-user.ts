import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { queryOne, query } from '@/lib/shared/db'

const GUEST_FOR_SESSION = 'SELECT id FROM users WHERE session_id = $1 AND is_guest = true AND merged_to_user_id IS NULL'
const SESSION_MAX_AGE = 30 * 24 * 60 * 60

/** A new guest session id. Sign-in merges a guest's cart only when the id starts with "guest_". */
export function newGuestSessionId(): string {
  return `guest_${Date.now()}_${randomUUID().slice(0, 8)}`
}

/** The session's guest, made on first use; null when the session's guest has signed in since (its cart moved). */
async function claimGuest(sessionId: string): Promise<string | null> {
  const existingGuest = await queryOne(GUEST_FOR_SESSION, [sessionId])
  if (existingGuest) return existingGuest.id

  // A page's requests run in parallel (the cart loads its lines and its saved list together), so two can make the
  // same session's guest at once: the second insert does nothing and takes the first one's row.
  const newGuest = await queryOne(
    `INSERT INTO users (email, first_name, is_guest, session_id, is_active)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [`guest_${sessionId}@temporary.local`, 'Guest', true, sessionId, true]
  )
  if (newGuest) return newGuest.id
  const raced = await queryOne(GUEST_FOR_SESSION, [sessionId])
  return raced?.id ?? null
}

/**
 * Get or create a guest user for the current session
 * @param sessionId The session ID from cookies
 * @returns The user ID (UUID) for the guest or existing user
 */
export async function getOrCreateGuestUser(sessionId: string): Promise<string> {
  const id = await claimGuest(sessionId)
  if (!id) throw new Error('Failed to create guest user')
  return id
}

/**
 * Whose cart and wishlist a read shows: the signed-in user, else the browser session's guest, or null when the
 * visitor has saved nothing yet. Reads never add a row. A visitor without a session cookie gets one here.
 */
export async function existingCartOwner(authUserId: string | undefined): Promise<string | null> {
  if (authUserId) return authUserId
  const jar = await cookies()
  const sessionId = jar.get('session_id')?.value
  if (!sessionId) {
    jar.set('session_id', newGuestSessionId(), { maxAge: SESSION_MAX_AGE, path: '/' })
    return null
  }
  const row = await queryOne(GUEST_FOR_SESSION, [sessionId])
  return row?.id ?? null
}

/**
 * Whose cart and wishlist a write changes: the signed-in user, else the session's guest, made on the first save. The
 * session cookie is set when missing, and replaced when its guest has signed in since.
 */
export async function cartOwner(authUserId: string | undefined): Promise<string> {
  if (authUserId) return authUserId
  const jar = await cookies()
  const sessionId = jar.get('session_id')?.value
  const id = sessionId ? await claimGuest(sessionId) : null
  if (id) return id
  const fresh = newGuestSessionId()
  jar.set('session_id', fresh, { maxAge: SESSION_MAX_AGE, path: '/' })
  return getOrCreateGuestUser(fresh)
}

/**
 * Merge guest user's cart and wishlist to actual user account
 * @param guestUserId The UUID of the guest user
 * @param actualUserId The UUID of the actual logged-in user
 */
export async function mergeGuestToUser(guestUserId: string, actualUserId: string): Promise<void> {
  try {
    // Call the database function to merge cart and wishlist
    await query('SELECT merge_guest_cart_to_user($1, $2)', [guestUserId, actualUserId])
    console.log(`Successfully merged guest ${guestUserId} to user ${actualUserId}`)
  } catch (error) {
    console.error('Failed to merge guest cart:', error)
    throw error
  }
}
