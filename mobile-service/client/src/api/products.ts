import { api } from './client'
import type { Product } from '../types'
import type { CardProduct, ProductOffer } from '../types/home'

/** A raw /api/products row: p.* plus categories, brands, product_images and the variant aggregates. */
export type ProductRow = Product & Record<string, any>

interface ProductsResponse {
  products: ProductRow[]
  total: number
  page: number
  totalPages: number
}

export interface ProductQuery {
  search?: string
  category?: string
  brand?: string
  sort?: string
  order?: string
  page?: number
  limit?: number
}

function productsQs(params: ProductQuery): string {
  const qs = new URLSearchParams()
  if (params.search) qs.set('search', params.search)
  if (params.category) qs.set('category', params.category)
  if (params.brand) qs.set('brand', params.brand)
  if (params.sort) qs.set('sort', params.sort)
  if (params.order) qs.set('order', params.order)
  if (params.page) qs.set('page', String(params.page))
  qs.set('limit', String(params.limit ?? 20))
  return qs.toString()
}

/** GET /api/products: search, one category slug (with its subtree), one brand id, created_at/name/base_price sort. */
export async function listProducts(params: ProductQuery): Promise<ProductsResponse> {
  return api(`/api/products?${productsQs(params)}`, { token: null })
}

/** A listing product (GET /api/products/listing): card props plus the grouped/table view fields. */
export interface ListingCard extends CardProduct {
  categoryId: string | null
  categorySlug: string | null
  handlingDays: number
  stockStatus: string | null
  grade: string | null
  material: string | null
  finish: string | null
  complianceStandard: string | null
}

export interface ListingFacetValue {
  value: string
  count: number
}

/** lib/catalog/product-filters FilterFacets. */
export interface ListingFacets {
  colors: { value: string; hex: string | null; count: number }[]
  grades: ListingFacetValue[]
  materials: ListingFacetValue[]
  finishes: ListingFacetValue[]
  compliances: ListingFacetValue[]
  origins: ListingFacetValue[]
  inStockCount: number
  onSaleCount: number
  priceMin: number
  priceMax: number
  hasRatings?: boolean
  variantTypes: ListingFacetValue[]
  variantValues: ListingFacetValue[]
  specFacets: { key: string; values: ListingFacetValue[] }[]
}

/** The listing's promo slot (product-offers-shared PromoOffer). */
export type PromoOffer = Pick<
  ProductOffer,
  'slug' | 'title' | 'subtitle' | 'badge_text' | 'badge_color' | 'image_url' | 'image_url_mobile' | 'blurhash' | 'blurhash_mobile' | 'cta_label'
>

export interface ListingPage {
  products: ListingCard[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  start: number
  end: number
  gstEnabled: boolean
}

/** The storefront /products model (lib/catalog/listing-model toListingModelJson). */
export interface ListingModel extends ListingPage {
  categories: { id: string; name: string; slug: string; parent_category_id: string | null; display_order: number | null }[]
  brands: { id: string; name: string }[]
  facets: ListingFacets
  offers: { slug: string; title: string }[]
  promoOffer: PromoOffer | null
}

/**
 * GET /api/products/listing: the web listing's filters, sort, paging and facets, server-side. Page 1 brings
 * the facets, categories, brands and offers; later pages ask for the products only (slim).
 */
export async function getListing(params: Record<string, string | undefined>, page: number, slim = page > 1): Promise<ListingModel> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v)
  if (page > 1) qs.set('page', String(page))
  if (slim) qs.set('slim', '1')
  return api(`/api/products/listing?${qs.toString()}`, { token: null })
}

export async function getProductBySlug(slug: string): Promise<Product> {
  const data = await api<{ product: Product }>(`/api/products/slug/${slug}`, { token: null })
  return data.product
}

/** A row of GET /api/products/search (the compare page's product picker). */
export interface ProductSearchResult {
  id: string
  name: string
  slug: string
  price: number
  mrp: number | null
  image_url: string | null
  thumbnail_url: string | null
  brand_name: string | null
  category_name: string | null
  category_id: string | null
}

export async function searchProducts(
  q: string,
  opts: { categoryId?: string | null; excludeIds?: string[]; limit?: number } = {}
): Promise<ProductSearchResult[]> {
  const qs = new URLSearchParams({ q, limit: String(opts.limit ?? 8) })
  if (opts.categoryId) qs.set('categoryId', opts.categoryId)
  for (const id of opts.excludeIds ?? []) qs.append('excludeId', id)
  const rows = await api<ProductSearchResult[]>(`/api/products/search?${qs.toString()}`, { token: null })
  return Array.isArray(rows) ? rows : []
}
