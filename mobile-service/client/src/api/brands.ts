import { api } from './client'
import type { Brand } from '../types'

/** Active brands, A–Z (GET /api/brands carries id, name and slug only). */
export async function listBrands(): Promise<Brand[]> {
  const data = await api<{ brands: Brand[] }>('/api/brands', { token: null })
  return data.brands || []
}

/** The storefront brand fields the pages read; logo, description and website when the API provides them. */
export type BrandDetail = Brand & { logo_url?: string | null; description?: string | null; website?: string | null }
