import { create } from 'zustand'
import type { Address } from '../../types'

// Hand-off between the Order Review screen (choices) and the payment screen (Razorpay / COD placement).
// 'manual' is the business portal's pay-later order (our team follows up); never COD for a business.
export type PayMethod = 'razorpay' | 'cod' | 'manual'

export interface PlaceOrderRequest {
  mode: 'cart' | 'buyNow'
  intent: string | null
  address: Address
  method: PayMethod
  couponId: string | null
  discountAmount: number
  shippingAmount: number
  codFeeAmount: number
  notes: string
  total: number
}

export interface ExistingOrder {
  id: string
  orderNumber: string
}

interface CheckoutState {
  request: PlaceOrderRequest | null
  submitError: string
  existingOrder: ExistingOrder | null
  begin: (request: PlaceOrderRequest) => void
  fail: (error: string, existingOrder?: ExistingOrder | null) => void
  clearError: () => void
  reset: () => void
}

export const useCheckoutStore = create<CheckoutState>(set => ({
  request: null,
  submitError: '',
  existingOrder: null,
  begin: request => set({ request, submitError: '', existingOrder: null }),
  fail: (submitError, existingOrder = null) => set({ submitError, existingOrder }),
  clearError: () => set({ submitError: '', existingOrder: null }),
  reset: () => set({ request: null, submitError: '', existingOrder: null }),
}))
