import { create } from 'zustand'
import type { User } from '../types'
import { storeToken, clearToken, getStoredToken, getAuthPortal, setAuthPortal, type AuthPortal } from '../api/client'
import { getMe } from '../api/auth'

const otherPortal = (p: AuthPortal): AuthPortal => (p === 'business' ? 'customer' : 'business')

/** Only an approved business account keeps a session (approval or rejection revokes the old ones). */
export const sessionUsable = (user: User | null, portal: AuthPortal) =>
  !!user && (portal !== 'business' || (user as { approvalStatus?: string }).approvalStatus === 'approved')

interface AuthState {
  user: User | null
  token: string | null
  portal: AuthPortal
  /** The store the app was last in, read from storage at launch (null until then), before the session is checked. */
  savedPortal: AuthPortal | null
  isLoading: boolean
  /** Each store's last signed-in user this run, so a switch back can show it before the session is re-checked. */
  known: Partial<Record<AuthPortal, User>>
  setAuth: (user: User, token: string, portal?: AuthPortal) => Promise<void>
  /** Signs out of the active store; the other store's saved session, if any, takes over. */
  clearAuth: () => Promise<void>
  /** Makes a store's saved session the active one; false when it has none that still works. */
  activate: (portal: AuthPortal) => Promise<boolean>
  /** Switches store: the business store needs its session (false = sign in); the storefront falls back to a guest.
   *  `onLost` runs when an optimistic switch's session turns out to be gone. */
  switchTo: (portal: AuthPortal, onLost?: () => void) => Promise<boolean>
  setLoading: (loading: boolean) => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  portal: 'customer',
  savedPortal: null,
  isLoading: true,
  known: {},
  setAuth: async (user, token, portal = 'customer') => {
    await setAuthPortal(portal)
    await storeToken(token, portal)
    set(s => ({ user, token, portal, known: { ...s.known, [portal]: user } }))
  },
  clearAuth: async () => {
    const current = get().portal
    await clearToken(current)
    if (await get().activate(otherPortal(current))) return
    await setAuthPortal('customer')
    set({ user: null, token: null, portal: 'customer' })
  },
  activate: async portal => {
    const token = await getStoredToken(portal)
    if (!token) return false
    const prev = getAuthPortal()
    await setAuthPortal(portal)
    const user = await getMe().catch(() => null)
    if (user && sessionUsable(user, portal)) {
      set(s => ({ user, token, portal, known: { ...s.known, [portal]: user } }))
      return true
    }
    if (user) await clearToken(portal)
    set(s => ({ known: { ...s.known, [portal]: undefined } }))
    await setAuthPortal(prev)
    return false
  },
  switchTo: async (portal, onLost) => {
    // Seen this run: switch now and re-check the session behind it, instead of a blank wait on /me.
    const known = get().known[portal]
    const token = known ? await getStoredToken(portal) : null
    if (known && token) {
      await setAuthPortal(portal)
      set({ user: known, token, portal })
      const lose = async () => {
        await clearToken(portal)
        set(s => ({ known: { ...s.known, [portal]: undefined } }))
        if (portal === 'business' && (await get().activate('customer'))) return onLost?.()
        await setAuthPortal('customer')
        set({ user: null, token: null, portal: 'customer' })
        onLost?.()
      }
      getMe().then(
        user => {
          if (get().portal !== portal) return
          if (sessionUsable(user, portal)) set(s => ({ user, known: { ...s.known, [portal]: user } }))
          else void lose()
        },
        // Network trouble keeps the store; only a session the server rejects falls back.
        (e: { status?: number }) => {
          if (get().portal === portal && (e?.status === 401 || e?.status === 403)) void lose()
        }
      )
      return true
    }
    if (await get().activate(portal)) return true
    if (portal === 'business') return false
    await setAuthPortal('customer')
    set({ user: null, token: null, portal: 'customer' })
    return true
  },
  setLoading: (isLoading) => set({ isLoading }),
}))
