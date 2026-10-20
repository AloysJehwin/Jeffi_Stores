import { create } from 'zustand'

type Kind = 'success' | 'error' | 'info'

interface ToastState {
  message: string | null
  kind: Kind
  seq: number
  show: (message: string, kind?: Kind) => void
  hide: () => void
}

export const useToastStore = create<ToastState>(set => ({
  message: null,
  kind: 'info',
  seq: 0,
  show: (message, kind = 'info') => set(s => ({ message, kind, seq: s.seq + 1 })),
  hide: () => set({ message: null }),
}))

export const showToast = (message: string, kind?: Kind) => useToastStore.getState().show(message, kind)
