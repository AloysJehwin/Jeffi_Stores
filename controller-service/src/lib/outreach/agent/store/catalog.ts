import { queryOne } from '@/lib/shared/db'
import type { ProductRef } from '../types'
import { rupees } from './format'
import { productLink } from './checkout'

// Wraps the storefront assistant's own search and product tools, so the agent and the shop assistant answer the same.

type Row = Record<string, unknown>

const inStock = (s: unknown) => String(s ?? '').toLowerCase() !== 'out of stock'

async function customerTool(name: 'search_products' | 'get_product') {
  const { getCustomerTool } = await import('@/lib/customer-agent/tools')
  const t = getCustomerTool(name)
  if (!t) throw new Error(`customer tool ${name} missing`)
  return t
}

export async function searchProducts(q: string, limit: number) {
  const t = await customerTool('search_products')
  const out = (await t.handler({ query: q, limit }, { authenticatedUserId: '' })) as { products?: Row[] }
  return (out.products ?? []).slice(0, limit).map(p => ({
    id: p.id,
    name: p.name,
    price: rupees(p.price as string),
    inStock: inStock(p.stock_status),
    summary: typeof p.short_description === 'string' ? p.short_description.slice(0, 200) : undefined,
  }))
}

const KEEP = ['name', 'short_description', 'price', 'stock_status', 'brand', 'category', 'features', 'warranty_months', 'warranty_type', 'return_window_days', 'in_the_box', 'color', 'material', 'size'] as const

/** The facts the agent may quote about one product; long text is trimmed. */
export async function getProduct(idOrSlug: string): Promise<Row | null> {
  const t = await customerTool('get_product')
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug)
  const out = (await t.handler(uuid ? { id: idOrSlug } : { slug: idOrSlug }, { authenticatedUserId: '' })) as Row
  if (!out || out.error) return null
  const data: Row = { id: out.id }
  for (const k of KEEP) if (out[k] != null) data[k] = k === 'price' ? rupees(out[k] as string) : typeof out[k] === 'string' ? (out[k] as string).slice(0, 400) : out[k]
  if (Array.isArray(out.faqs)) data.faqs = (out.faqs as Row[]).slice(0, 5)
  return data
}

/** id or slug to the product's id, name, slug and link (active products only). */
export async function productCard(idOrSlug: string): Promise<{ id: string; name: string; slug: string | null; url: string | null } | null> {
  const p = await queryOne<{ id: string; name: string; slug: string | null }>(
    `SELECT id::text, name, slug FROM products WHERE (id::text = $1 OR slug = $1) AND is_active = TRUE LIMIT 1`,
    [idOrSlug]
  )
  if (!p) return null
  return { ...p, url: p.slug ? await productLink(p.slug) : null }
}

export async function toProductRef(idOrSlug: string): Promise<ProductRef | null> {
  const { VARIANT_MIN_PRICE_SQL } = await import('@/lib/queries')
  const p = await queryOne<{ id: string; name: string; slug: string | null; price: string; stock_status: string | null }>(
    `SELECT p.id::text, p.name, p.slug, COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price, p.stock_status
       FROM products p WHERE (p.id::text = $1 OR p.slug = $1) AND p.is_active = TRUE LIMIT 1`,
    [idOrSlug]
  )
  if (!p) return null
  return { id: p.id, name: p.name, price: rupees(p.price), inStock: inStock(p.stock_status), slug: p.slug }
}

export async function storeInfo() {
  const { getStoreIdentity, getStorefrontContent } = await import('@/lib/catalog/site-controls')
  const [id, content] = await Promise.all([getStoreIdentity(), getStorefrontContent()])
  return {
    name: id.name,
    email: id.email || undefined,
    phone: id.phone || undefined,
    website: id.web || undefined,
    hours: content.businessHours ? content.businessHours.split('\n').map(l => l.trim()).filter(Boolean) : undefined,
  }
}

export async function storeName(): Promise<string> {
  const { getStoreIdentity } = await import('@/lib/catalog/site-controls')
  return (await getStoreIdentity()).name
}
