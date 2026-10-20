import { create } from 'zustand'

interface CartState {
  count: number
  setCount: (count: number) => void
  increment: () => void
  decrement: () => void
  reset: () => void
}

export const useCartStore = create<CartState>((set) => ({
  count: 0,
  setCount: (count) => set({ count }),
  increment: () => set((s) => ({ count: s.count + 1 })),
  decrement: () => set((s) => ({ count: Math.max(0, s.count - 1) })),
  reset: () => set({ count: 0 }),
}))
