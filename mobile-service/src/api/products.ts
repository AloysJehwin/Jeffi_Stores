import { api } from './client'
import type { Product } from '../types'

interface ProductsResponse {
  products: Product[]
  total: number
  page: number
  totalPages: number
}

export async function listProducts(params: {
  search?: string
  category?: string
  brand?: string
  sort?: string
  order?: string
  page?: number
  limit?: number
}): Promise<ProductsResponse> {
  const qs = new URLSearchParams()
  if (params.search) qs.set('search', params.search)
  if (params.category) qs.set('category', params.category)
  if (params.brand) qs.set('brand', params.brand)
  if (params.sort) qs.set('sort', params.sort)
  if (params.order) qs.set('order', params.order)
  if (params.page) qs.set('page', String(params.page))
  qs.set('limit', String(params.limit ?? 20))
  return api(`/api/products?${qs.toString()}`, { token: null })
}

export async function getProductBySlug(slug: string): Promise<Product> {
  const data = await api<{ product: Product }>(`/api/products/slug/${slug}`, { token: null })
  return data.product
}
