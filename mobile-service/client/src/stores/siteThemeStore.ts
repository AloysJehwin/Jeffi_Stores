import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'

// The store's Site Builder theme (CSS variables NativeWind resolves at runtime), from GET /api/home. Saved so the next
// launch starts in the store's colours instead of flashing the built-in ones.

const KEY = 'site-theme'

interface SiteThemeState {
  vars: Record<string, string> | null
  set: (vars: Record<string, string> | null) => void
  hydrate: () => Promise<void>
}

export const useSiteThemeStore = create<SiteThemeState>((set, get) => ({
  vars: null,
  set: vars => {
    if (JSON.stringify(vars) === JSON.stringify(get().vars)) return
    set({ vars })
    void (vars ? AsyncStorage.setItem(KEY, JSON.stringify(vars)) : AsyncStorage.removeItem(KEY)).catch(() => {})
  },
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY)
      if (raw && !get().vars) set({ vars: JSON.parse(raw) })
    } catch {
      // keep the built-in look
    }
  },
}))
