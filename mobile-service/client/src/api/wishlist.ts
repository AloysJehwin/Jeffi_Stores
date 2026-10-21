import { api } from './client'
import type { WishlistItem } from '../types'

export async function getWishlist(): Promise<WishlistItem[]> {
  const data = await api<{ items: WishlistItem[] }>('/api/wishlist')
  return data.items
}

export async function addToWishlist(product_id: string): Promise<void> {
  await api('/api/wishlist', { method: 'POST', body: JSON.stringify({ product_id }) })
}

export async function removeFromWishlist(product_id: string): Promise<void> {
  await api(`/api/wishlist?product_id=${encodeURIComponent(product_id)}`, { method: 'DELETE' })
}
