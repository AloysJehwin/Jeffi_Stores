import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import type { StoryGroup } from '../types/home'

// One story viewer for the whole app (StoryViewerHost at the root); the home rings open it.
// A group is "seen" once its stored slide count matches the current one, so new slides light it up again.

const SEEN_KEY = 'jeffi:stories:seen'

interface StoryState {
  groups: StoryGroup[]
  /** The group the viewer opened on. */
  index: number
  /** Bumped per open so the viewer remounts fresh. */
  seq: number
  /** groupId → slide count at the last viewing (mirrors AsyncStorage). */
  seen: Record<string, number>
  open: (groups: StoryGroup[], index: number) => void
  close: () => void
  markSeen: (group: StoryGroup) => void
  hydrateSeen: () => Promise<void>
}

let hydration: Promise<void> | null = null

export const useStoryStore = create<StoryState>((set, get) => ({
  groups: [],
  index: 0,
  seq: 0,
  seen: {},
  open: (groups, index) => set(s => ({ groups, index, seq: s.seq + 1 })),
  close: () => set({ groups: [] }),
  markSeen: group => {
    const seen = { ...get().seen, [group.id]: group.slides.length }
    set({ seen })
    AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seen)).catch(() => {})
  },
  hydrateSeen: () => {
    if (!hydration) {
      hydration = AsyncStorage.getItem(SEEN_KEY)
        .then(raw => {
          const parsed: unknown = raw ? JSON.parse(raw) : null
          const stored: Record<string, number> = {}
          if (parsed && typeof parsed === 'object') {
            for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === 'number') stored[k] = v
          }
          // Anything viewed while loading wins over the stored copy.
          set(s => ({ seen: { ...stored, ...s.seen } }))
        })
        .catch(() => {})
    }
    return hydration
  },
}))

export const openStories = (groups: StoryGroup[], index: number) => useStoryStore.getState().open(groups, index)

export const isGroupSeen = (seen: Record<string, number>, group: StoryGroup) => seen[group.id] === group.slides.length
