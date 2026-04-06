import { queryOne, query } from './db'

/**
 * Get or create a guest user for the current session
 * @param sessionId The session ID from cookies
 * @returns The user ID (UUID) for the guest or existing user
 */
export async function getOrCreateGuestUser(sessionId: string): Promise<string> {
  // Check if there's already a guest user with this session_id
  const existingGuest = await queryOne(
    'SELECT id FROM users WHERE session_id = $1 AND is_guest = true AND merged_to_user_id IS NULL',
    [sessionId]
  )

  if (existingGuest) {
    return existingGuest.id
  }

  // Create a new guest user
  const newGuest = await queryOne(
    `INSERT INTO users (email, first_name, is_guest, session_id, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [`guest_${sessionId}@temporary.local`, 'Guest', true, sessionId, true]
  )

  if (!newGuest) {
    throw new Error('Failed to create guest user')
  }

  return newGuest.id
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

/**
 * Get user ID from session - either guest or logged-in user
 * @param sessionId The session ID from cookies
 * @param authUserId Optional authenticated user ID
 * @returns The user ID to use for cart/wishlist operations
 */
export async function getUserIdForSession(
  sessionId: string | undefined,
  authUserId?: string
): Promise<string> {
  // If user is authenticated, return their ID
  if (authUserId) {
    return authUserId
  }

  // If no session ID, create one
  if (!sessionId) {
    sessionId = `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`
  }

  // Get or create guest user
  return await getOrCreateGuestUser(sessionId)
}
