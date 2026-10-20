import { create } from 'zustand'
import type { User } from '../types'
import { storeToken, clearToken } from '../api/client'

interface AuthState {
  user: User | null
  token: string | null
  isLoading: boolean
  setAuth: (user: User, token: string) => Promise<void>
  clearAuth: () => Promise<void>
  setLoading: (loading: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoading: true,
  setAuth: async (user, token) => {
    await storeToken(token)
    set({ user, token })
  },
  clearAuth: async () => {
    await clearToken()
    set({ user: null, token: null })
  },
  setLoading: (isLoading) => set({ isLoading }),
}))
