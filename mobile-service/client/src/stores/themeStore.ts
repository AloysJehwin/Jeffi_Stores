import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { colorScheme as nwColorScheme } from 'nativewind'

export type ThemePreference = 'system' | 'light' | 'dark'

const KEY = 'theme-preference'

interface ThemeState {
  preference: ThemePreference
  setPreference: (p: ThemePreference) => void
  /** The TopNav toggle: an explicit light or dark choice. */
  setColorScheme: (scheme: 'light' | 'dark') => void
  hydrate: () => Promise<void>
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: 'system',
  setPreference: p => {
    nwColorScheme.set(p)
    set({ preference: p })
    AsyncStorage.setItem(KEY, p).catch(() => {})
  },
  setColorScheme: scheme => get().setPreference(scheme),
  hydrate: async () => {
    const saved = await AsyncStorage.getItem(KEY).catch(() => null)
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      nwColorScheme.set(saved)
      set({ preference: saved })
    }
  },
}))
