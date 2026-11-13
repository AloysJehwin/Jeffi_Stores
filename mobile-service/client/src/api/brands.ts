import { api } from './client'
import type { Brand, BrandProfile } from '../types'

/** Active brands, A–Z (GET /api/brands carries id, name and slug only). */
export async function listBrands(): Promise<Brand[]> {
  const data = await api<{ brands: Brand[] }>('/api/brands', { token: null })
  return data.brands || []
}

/** The storefront brand fields the pages read; logo, description and website when the API provides them. */
export type BrandDetail = Brand & { logo_url?: string | null; description?: string | null; website?: string | null }

/** The brand page's profile (GET /api/brands/{slug}); null when the brand is missing or inactive. */
export async function getBrand(slug: string): Promise<BrandProfile | null> {
  try {
    const data = await api<{ brand: BrandProfile }>(`/api/brands/${encodeURIComponent(slug)}`, { token: null })
    return data.brand ?? null
  } catch (e: any) {
    if (e?.status === 404) return null
    throw e
  }
}

export type BrandWithCount = BrandDetail & { product_count: number }

/** The /brands page rows: active brands A–Z with description, logo and active product count. */
export async function listBrandsWithCounts(): Promise<BrandWithCount[]> {
  const data = await api<{ brands: BrandWithCount[] }>('/api/brands?counts=1', { token: null })
  return data.brands || []
}
