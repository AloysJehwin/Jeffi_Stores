import type { HomepageSurface } from '@/lib/catalog/homepage-sections'

export interface HeroSlide {
  id: string
  title: string
  subtitle: string | null
  badge_text: string | null
  badge_color: string | null
  image_url: string | null
  image_url_mobile: string | null
  blurhash?: string | null
  blurhash_mobile?: string | null
  cta_label: string | null
  cta_url: string | null
  filter_category: string | null
  filter_brand: string | null
  filter_grade: string | null
  filter_material: string | null
  filter_min_price: number | null
  filter_max_price: number | null
  filter_in_stock: boolean
  filter_on_sale: boolean
  display_order: number
  is_active: boolean
  /** Absent on rows saved before the column existed; read it through rowSurface(). */
  surface?: HomepageSurface | null
  created_at: string
  updated_at: string
}

/**
 * Build the destination URL for a slide. A manually-typed cta_url wins; otherwise
 * we assemble a /products?... link from whatever filters the admin assigned.
 * Returns '/products' with no params if nothing is set.
 */
export function heroSlideHref(slide: {
  cta_url?: string | null
  filter_category?: string | null
  filter_brand?: string | null
  filter_grade?: string | null
  filter_material?: string | null
  filter_min_price?: number | null
  filter_max_price?: number | null
  filter_in_stock?: boolean | null
  filter_on_sale?: boolean | null
}): string {
  if (slide.cta_url && slide.cta_url.trim()) return slide.cta_url.trim()

  const params = new URLSearchParams()
  if (slide.filter_category) params.set('category', slide.filter_category)
  if (slide.filter_brand) params.set('brand', slide.filter_brand)
  if (slide.filter_grade) params.set('grade', slide.filter_grade)
  if (slide.filter_material) params.set('material', slide.filter_material)
  if (slide.filter_min_price != null) params.set('minPrice', String(slide.filter_min_price))
  if (slide.filter_max_price != null) params.set('maxPrice', String(slide.filter_max_price))
  if (slide.filter_in_stock) params.set('inStock', '1')
  if (slide.filter_on_sale) params.set('onSale', '1')

  const qs = params.toString()
  return `/products${qs ? `?${qs}` : ''}`
}
