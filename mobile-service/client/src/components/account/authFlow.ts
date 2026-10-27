import type { User } from '../../types'
import type { AccountUser } from '../../api/account'
import { useAuthStore } from '../../stores/authStore'
import type { AuthPortal } from '../../api/client'
import { refreshUser } from './hooks'

// Glue between the login / otp / signup screens.

type GoogleSignup = { idToken: string; profile: { email: string; firstName: string; lastName: string } }

// The web keeps this in sessionStorage so the token never rides in the URL; here it stays in memory.
let pendingGoogle: GoogleSignup | null = null
export const setPendingGoogle = (v: GoogleSignup | null) => {
  pendingGoogle = v
}
export const getPendingGoogle = () => pendingGoogle

/** Store the session the way the app always has, then load the full /api/auth/me (or /api/business/me) user. */
export async function finishSignIn(user: User, token: string, portal: AuthPortal = 'customer'): Promise<AccountUser> {
  await useAuthStore.getState().setAuth(user, token, portal)
  return (await refreshUser()) ?? (user as AccountUser)
}
