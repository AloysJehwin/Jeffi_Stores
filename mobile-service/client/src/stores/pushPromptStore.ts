import { create } from 'zustand'

// The push soft ask, mounted once at the root (PushPermissionSheetHost).

/** welcome: first launch; order: after an order is placed; settings: the user tapped "Turn on";
 *  reminder: push still off on a periodic app open. */
export type PushPromptReason = 'welcome' | 'order' | 'settings' | 'reminder'

interface PushPromptState {
  reason: PushPromptReason | null
  open: (reason: PushPromptReason) => void
  close: () => void
}

export const usePushPromptStore = create<PushPromptState>(set => ({
  reason: null,
  open: reason => set({ reason }),
  close: () => set({ reason: null }),
}))

export const openPushPrompt = (reason: PushPromptReason) => usePushPromptStore.getState().open(reason)
