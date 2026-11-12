import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { HomeAudience, HomePage, HomeSection, SectionType } from '../types/home'

// The shape of the last home layout the app saw, per page and audience, so a cold start's skeleton
// matches the page that is about to land (GET /api/home is the only source of the layout).

export interface LayoutEntry {
  type: SectionType
  /** Listing pages: products before it. */
  after?: number
}

const KEY = 'home-layouts'
export const layoutKey = (page: HomePage, audience: HomeAudience = 'store') => `${page}:${audience}`

interface HomeLayoutState {
  layouts: Record<string, LayoutEntry[]>
  remember: (page: HomePage, audience: HomeAudience, sections: HomeSection[]) => void
  hydrate: () => Promise<void>
}

export const useHomeLayoutStore = create<HomeLayoutState>((set, get) => ({
  layouts: {},
  remember: (page, audience, sections) => {
    const entries = sections.map(s => (page === 'home' ? { type: s.type } : { type: s.type, after: s.placement?.after ?? 0 }))
    const key = layoutKey(page, audience)
    const prev = get().layouts[key]
    if (prev && JSON.stringify(prev) === JSON.stringify(entries)) return
    const layouts = { ...get().layouts, [key]: entries }
    set({ layouts })
    AsyncStorage.setItem(KEY, JSON.stringify(layouts)).catch(() => {})
  },
  hydrate: async () => {
    const raw = await AsyncStorage.getItem(KEY).catch(() => null)
    if (!raw) return
    try {
      const saved = JSON.parse(raw)
      if (saved && typeof saved === 'object') set({ layouts: { ...saved, ...get().layouts } })
    } catch {}
  },
}))

export const useHomeLayout = (page: HomePage, audience: HomeAudience = 'store'): LayoutEntry[] | undefined =>
  useHomeLayoutStore(s => s.layouts[layoutKey(page, audience)])
