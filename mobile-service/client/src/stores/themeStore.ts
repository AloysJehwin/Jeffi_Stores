import { create } from 'zustand'
import { colorScheme as nwColorScheme } from 'nativewind'

type ColorScheme = 'light' | 'dark'

interface ThemeState {
  colorScheme: ColorScheme
  setColorScheme: (scheme: ColorScheme) => void
  toggle: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  colorScheme: 'light',
  setColorScheme: (scheme) => {
    nwColorScheme.set(scheme)
    set({ colorScheme: scheme })
  },
  toggle: () => {
    const next = get().colorScheme === 'light' ? 'dark' : 'light'
    nwColorScheme.set(next)
    set({ colorScheme: next })
  },
}))
