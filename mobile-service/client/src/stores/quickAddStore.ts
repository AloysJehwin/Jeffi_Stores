import { create } from 'zustand'
import type { CardProduct } from '../types/home'

// One quick-add sheet for the whole app, mounted at the root (QuickAddSheetHost); any card opens it.

interface QuickAddState {
  /** The card that opened the sheet: shown while the full product loads. */
  seed: CardProduct | null
  /** Bumped after a successful add so the card's "+" can bounce. */
  addedSeq: number
  addedProductId: string | null
  open: (seed: CardProduct) => void
  close: () => void
  markAdded: (productId: string) => void
}

export const useQuickAddStore = create<QuickAddState>(set => ({
  seed: null,
  addedSeq: 0,
  addedProductId: null,
  open: seed => set({ seed }),
  close: () => set({ seed: null }),
  markAdded: productId => set(s => ({ addedSeq: s.addedSeq + 1, addedProductId: productId })),
}))

export const openQuickAdd = (seed: CardProduct) => useQuickAddStore.getState().open(seed)
