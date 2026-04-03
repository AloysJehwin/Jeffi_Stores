import { supabaseAdmin } from './supabase'

/**
 * Get or create a guest user for the current session
 * @param sessionId The session ID from cookies
 * @returns The user ID (UUID) for the guest or existing user
 */
export async function getOrCreateGuestUser(sessionId: string): Promise<string> {
  // Check if there's already a guest user with this session_id
  const { data: existingGuest } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('session_id', sessionId)
    .eq('is_guest', true)
    .is('merged_to_user_id', null)
    .single()

  if (existingGuest) {
    return existingGuest.id
  }

  // Create a new guest user
  const { data: newGuest, error } = await supabaseAdmin
    .from('users')
    .insert({
      email: `guest_${sessionId}@temporary.local`,
      first_name: 'Guest',
      is_guest: true,
      session_id: sessionId,
      is_active: true,
    })
    .select('id')
    .single()

  if (error || !newGuest) {
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
    const { error } = await supabaseAdmin.rpc('merge_guest_cart_to_user', {
      p_guest_user_id: guestUserId,
      p_actual_user_id: actualUserId,
    })

    if (error) {
      console.error('Error merging guest cart:', error)
      throw error
    }

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
