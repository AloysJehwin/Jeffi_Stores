import * as React from 'react'
import { queryMany, queryOne } from '@/lib/shared/db'
import { listBrandsWithCounts } from '@/lib/catalog/storefront-counts'
import { safeHref, safeSrc } from '../code/allow'
import type { BrandIndexView, BrandPageView, CategoryIndexView, CategoryPageView, SubCategoryView } from './types'

// The category and brand pages' own records as code-section views. The storefront routes map the rows they already
// load; the live SiteData loads them by slug (the studio preview over the store's own catalogue) and in full for the
// all-categories and all-brands pages.

type Row = Record<string, any>
type Faq = { id: string; question: string; answer: string }

// React's per-request cache, so a part's count and its render share one query; a plain call where it is missing.
const reactCache = (React as unknown as { cache?: <F extends (...a: never[]) => unknown>(fn: F) => F }).cache
const perRequest = <F extends (...a: never[]) => unknown>(fn: F): F => (typeof reactCache === 'function' ? reactCache(fn) : fn)

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const pic = (...vs: unknown[]) => vs.map(safeSrc).find((u): u is string => !!u) ?? null

/** An outside link as https (http upgraded, a bare domain completed), or null. */
function httpsUrl(v: unknown): string | null {
  const s = text(v)
  if (/^https?:\/\//i.test(s)) return safeHref(s.replace(/^http:/i, 'https:'))
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s) ? safeHref(`https://${s}`) : null
}

// The brand profile's colour, social links and origin, read as the brand page's own blocks read them
// (components/visitor/brand/BrandProfile).
const SOCIAL = [['instagram', 'Instagram'], ['youtube', 'YouTube'], ['facebook', 'Facebook'], ['linkedin', 'LinkedIn'], ['x', 'X']] as const

function socialsOf(raw: unknown): BrandPageView['socials'] {
  let obj: unknown = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      obj = null
    }
  }
  if (!obj || typeof obj !== 'object') return []
  return SOCIAL.flatMap(([network, label]) => {
    const href = httpsUrl((obj as Record<string, unknown>)[network])
    return href ? [{ network, label, href }] : []
  })
}

const accentOf = (v: unknown) => (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(text(v)) ? text(v) : null)

function countryOf(code: unknown): string | null {
  const c = text(code).toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return null
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(c) ?? c
  } catch {
    return c
  }
}

/** Active products under each category: in it and its subcategories at any depth (what its listing shows). */
export async function categoryCounts(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map()
  const rows = await queryMany<{ id: string; n: number }>(
    `WITH RECURSIVE tree AS (
       SELECT id, id AS root FROM categories WHERE id = ANY($1::uuid[])
       UNION
       SELECT c.id, t.root FROM categories c JOIN tree t ON c.parent_category_id = t.id
     )
     SELECT t.root AS id, COUNT(p.id)::int AS n
       FROM tree t JOIN products p ON p.category_id = t.id AND p.is_active = true
      GROUP BY t.root`,
    [ids]
  )
  return new Map(rows.map(r => [String(r.id), Number(r.n) || 0]))
}

/**
 * A photo for each category that has no picture of its own: its featured (else newest) product's, from it or any
 * subcategory, so a category tile never stands empty while the category has a photographed product.
 */
export async function categoryPhotos(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const rows = await queryMany<{ id: string; image_url: string }>(
    `WITH RECURSIVE tree AS (
       SELECT id, id AS root FROM categories WHERE id = ANY($1::uuid[])
       UNION
       SELECT c.id, t.root FROM categories c JOIN tree t ON c.parent_category_id = t.id WHERE c.is_active = true
     )
     SELECT r.root AS id, pic.image_url
       FROM unnest($1::uuid[]) AS r(root)
       CROSS JOIN LATERAL (
         SELECT pi.image_url FROM tree t
           JOIN products p ON p.category_id = t.id AND p.is_active = true AND p.is_draft IS NOT TRUE
           JOIN product_images pi ON pi.product_id = p.id
          WHERE t.root = r.root
          ORDER BY p.is_featured DESC NULLS LAST, pi.is_primary DESC NULLS LAST, p.created_at DESC, pi.display_order ASC NULLS LAST
          LIMIT 1
       ) pic`,
    [ids]
  )
  return new Map(rows.filter(r => safeSrc(r.image_url)).map(r => [String(r.id), r.image_url]))
}

/** The rows without a picture of their own (`own` reads it) given their products' photo. */
async function withPhotos<T extends Row>(rows: T[], own: (r: T) => unknown): Promise<Map<string, string>> {
  return categoryPhotos(rows.filter(r => !pic(own(r))).map(r => String(r.id))).catch(() => new Map())
}

const subView = (c: Row, counts: Map<string, number>, photos?: Map<string, string>): SubCategoryView => ({
  id: String(c.id),
  slug: String(c.slug),
  name: String(c.name),
  url: `/categories/${c.slug}`,
  image: pic(c.image_url, photos?.get(String(c.id))),
  productCount: counts.get(String(c.id)) ?? 0,
})

/** The category page's row (with parent_name and parent_slug), its subcategories and FAQs as the `<Category>` view. */
export function categoryPageView(row: Row, children: Row[], faqs: Faq[], counts: Map<string, number>, photos?: Map<string, string>): CategoryPageView {
  const image = pic(row.hero_image_desktop, row.image_url)
  const link = text(row.banner_link_url)
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    url: `/categories/${row.slug}`,
    description: text(row.description),
    tagline: text(row.tagline),
    image,
    mobileImage: pic(row.hero_image_mobile) ?? image,
    bannerUrl: link.startsWith('/') ? safeHref(link) : httpsUrl(link),
    parentName: row.parent_slug ? text(row.parent_name) || null : null,
    parentUrl: row.parent_slug ? `/categories/${row.parent_slug}` : null,
    productCount: counts.get(String(row.id)) ?? 0,
    children: children.map(c => subView(c, counts, photos)),
    faqs: faqs.map(f => ({ id: String(f.id), question: text(f.question), answer: text(f.answer) })).filter(f => f.question && f.answer),
    seoText: text(row.seo_content),
  }
}

export async function brandProductCount(brandId: string): Promise<number> {
  const row = await queryOne<{ n: number }>('SELECT COUNT(*)::int AS n FROM products WHERE brand_id = $1 AND is_active = true', [brandId])
  return Number(row?.n) || 0
}

/** The brand page's row as the `<Brand>` view. */
export function brandPageView(row: Row, productCount: number): BrandPageView {
  const image = pic(row.banner_desktop_url)
  const founded = String(row.founded_year ?? '').trim()
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    url: `/brands/${row.slug}`,
    logo: pic(row.logo_url),
    tagline: text(row.tagline),
    description: text(row.description),
    story: text(row.story),
    website: httpsUrl(row.website),
    color: accentOf(row.brand_color),
    image,
    mobileImage: pic(row.banner_mobile_url) ?? image,
    founded: /^\d{4}$/.test(founded) ? founded : null,
    headquarters: text(row.headquarters) || null,
    origin: countryOf(row.country_of_origin),
    socials: socialsOf(row.social_links),
    productCount,
    seoText: text(row.seo_content),
  }
}

export const loadCategoryPage = perRequest(async (slug: string): Promise<CategoryPageView | null> => {
  if (!slug || slug.length > 120) return null
  const row = await queryOne<Row>(
    `SELECT c.*, pc.name AS parent_name, pc.slug AS parent_slug
       FROM categories c
       LEFT JOIN categories pc ON pc.id = c.parent_category_id AND pc.is_active = true
      WHERE c.slug = $1 AND c.is_active = true
      LIMIT 1`,
    [slug]
  )
  if (!row) return null
  const [children, faqs] = await Promise.all([
    queryMany<Row>('SELECT id, name, slug, image_url FROM categories WHERE parent_category_id = $1 AND is_active = true ORDER BY display_order ASC', [row.id]),
    // As the category page lists them (CategoryFaqs' listCategoryFaqs).
    queryMany<Faq>('SELECT id, question, answer FROM category_faqs WHERE category_id = $1 AND published = true ORDER BY sort_order ASC, created_at ASC', [row.id]),
  ])
  const [counts, photos] = await Promise.all([categoryCounts([String(row.id), ...children.map(c => String(c.id))]), withPhotos(children, c => c.image_url)])
  return categoryPageView(row, children, faqs, counts, photos)
})

export const loadBrandPage = perRequest(async (slug: string): Promise<BrandPageView | null> => {
  if (!slug || slug.length > 120) return null
  const row = await queryOne<Row>('SELECT * FROM brands WHERE slug = $1 AND is_active = true LIMIT 1', [slug])
  return row ? brandPageView(row, await brandProductCount(String(row.id))) : null
})

/** Every top-level category with its subcategories, in the store's order (as the built-in /categories lists them). */
export const loadCategoryIndex = perRequest(async (): Promise<CategoryIndexView[]> => {
  const rows = await queryMany<Row>(
    'SELECT id, name, slug, description, tagline, image_url, hero_image_desktop, parent_category_id FROM categories WHERE is_active = true ORDER BY display_order ASC, name ASC'
  )
  const [counts, photos] = await Promise.all([categoryCounts(rows.map(r => String(r.id))), withPhotos(rows, r => r.image_url ?? (r.parent_category_id ? null : r.hero_image_desktop))])
  const kids = new Map<string, Row[]>()
  for (const r of rows) if (r.parent_category_id) kids.set(String(r.parent_category_id), [...(kids.get(String(r.parent_category_id)) ?? []), r])
  return rows
    .filter(r => !r.parent_category_id)
    .map(r => ({
      ...subView(r, counts, photos),
      image: pic(r.image_url, r.hero_image_desktop, photos.get(String(r.id))),
      tagline: text(r.tagline),
      description: text(r.description),
      children: (kids.get(String(r.id)) ?? []).map(c => subView(c, counts, photos)),
    }))
})

/** Every active brand, featured first, with its product count. */
export const loadBrandIndex = perRequest(async (): Promise<BrandIndexView[]> =>
  (await listBrandsWithCounts()).map(b => ({
    id: String(b.id),
    slug: b.slug,
    name: b.name,
    url: `/brands/${b.slug}`,
    logo: pic(b.logo_url),
    tagline: text(b.tagline),
    description: text(b.description),
    productCount: Number(b.product_count) || 0,
    featured: !!b.is_featured,
  }))
)
