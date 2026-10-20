import { api } from './client'
import type { CartItem } from '../types'

interface CartResponse {
  items: CartItem[]
}

export async function getCart(): Promise<CartResponse> {
  return api('/api/cart')
}

export async function addToCart(payload: {
  product_id: string
  variant_id?: string | null
  quantity: number
  buy_mode?: string
  buy_unit?: string | null
}): Promise<void> {
  await api<unknown>('/api/cart', {
    method: 'POST',
    body: JSON.stringify({
      productId: payload.product_id,
      variantId: payload.variant_id ?? null,
      quantity: payload.quantity,
      buyMode: payload.buy_mode ?? 'unit',
      buyUnit: payload.buy_unit ?? null,
    }),
  })
}

export async function updateCartItem(itemId: string, quantity: number): Promise<void> {
  await api<unknown>('/api/cart', {
    method: 'PATCH',
    body: JSON.stringify({ cartItemId: itemId, quantity }),
  })
}

export async function removeCartItem(itemId: string): Promise<void> {
  await api<unknown>(`/api/cart?id=${itemId}`, { method: 'DELETE' })
}
