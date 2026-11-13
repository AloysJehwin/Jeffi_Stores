import type { MetadataRoute } from 'next'
import { queryMany } from '@/lib/shared/db'
import { getStorePolicies } from '@/lib/legals/store-policies'
import { siteOrigin } from './site-origin'

type Row = { slug: string; updated_at: Date | null }

/** Every public page of the store, so search and AdSense crawlers can find the whole catalogue. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await siteOrigin()
  const [products, categories, brands, policies] = await Promise.all([
    queryMany<Row>(`SELECT slug, updated_at FROM products WHERE is_active = true AND slug IS NOT NULL ORDER BY updated_at DESC NULLS LAST`).catch(() => []),
    queryMany<Row>(`SELECT slug, updated_at FROM categories WHERE is_active = true AND slug IS NOT NULL`).catch(() => []),
    queryMany<Row>(`SELECT slug, created_at AS updated_at FROM brands WHERE is_active = true AND slug IS NOT NULL`).catch(() => []),
    getStorePolicies().catch(() => []),
  ])

  const page = (path: string, priority: number, lastModified?: Date | null): MetadataRoute.Sitemap[number] => ({
    url: `${origin}${path}`,
    priority,
    ...(lastModified ? { lastModified } : {}),
  })

  return [
    page('/', 1),
    page('/products', 0.9),
    page('/categories', 0.8),
    page('/brands', 0.7),
    page('/about', 0.5),
    page('/contact', 0.5),
    page('/support', 0.4),
    page('/return-policy', 0.3),
    page('/legal', 0.3),
    ...policies.map(p => page(`/legal/${p.slug}`, 0.3)),
    ...categories.map(c => page(`/categories/${c.slug}`, 0.8, c.updated_at)),
    ...brands.map(b => page(`/brands/${b.slug}`, 0.6, b.updated_at)),
    ...products.map(p => page(`/products/${p.slug}`, 0.7, p.updated_at)),
  ]
}
