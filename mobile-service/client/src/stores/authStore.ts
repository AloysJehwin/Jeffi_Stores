import { create } from 'zustand'
import type { User } from '../types'
import { storeToken, clearToken, setAuthPortal, type AuthPortal } from '../api/client'

interface AuthState {
  user: User | null
  token: string | null
  portal: AuthPortal
  isLoading: boolean
  setAuth: (user: User, token: string, portal?: AuthPortal) => Promise<void>
  clearAuth: () => Promise<void>
  setLoading: (loading: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  portal: 'customer',
  isLoading: true,
  setAuth: async (user, token, portal = 'customer') => {
    await storeToken(token)
    await setAuthPortal(portal)
    set({ user, token, portal })
  },
  clearAuth: async () => {
    await clearToken()
    await setAuthPortal('customer')
    set({ user: null, token: null, portal: 'customer' })
  },
  setLoading: (isLoading) => set({ isLoading }),
}))
