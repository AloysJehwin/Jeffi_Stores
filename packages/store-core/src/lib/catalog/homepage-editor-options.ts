import { queryMany, queryOne } from '@/lib/shared/db'
import { getStorefrontContent, getStoreIdentity } from '@/lib/catalog/site-controls'
import { copyDefaultsFor, defaultAboutCopy, resolveAboutStats, tileDefaultsFor } from '@/lib/catalog/homepage-sections'
import { isFlagshipTenant } from '@/lib/payments/wallet'
import type { SectionCopy, SectionType } from '@/lib/catalog/homepage-sections'

// The picker options and counts the section editors show (Homepage editor and Site Builder).

export interface SectionOptions {
  categories: { value: string; label: string }[]
  brands: { value: string; label: string }[]
  /** Top-level categories by id, for sections that pick whole departments (category tabs). */
  topCategories?: { value: string; label: string }[]
  counts: {
    featured: number
    newArrivals: number
    bestSellers: number
    onSale: number
    bundles?: number
    approvedReviews?: number
  }
  /** Store-specific storefront defaults, e.g. the About story from the store settings. */
  copyDefaults?: Partial<Record<SectionType, SectionCopy>>
  /** Store-specific built-in tiles, e.g. the About stats from the store settings. */
  tileDefaults?: Partial<Record<SectionType, Record<string, string>[]>>
}

export async function loadHeroData() {
  const [cats, brands, grades, materials] = await Promise.all([
    queryMany<{ slug: string; name: string }>(
      `SELECT slug, name FROM categories WHERE is_active = true AND slug IS NOT NULL ORDER BY name`
    ),
    queryMany<{ id: string; name: string }>(`SELECT id, name FROM brands WHERE is_active = true ORDER BY name`),
    queryMany<{ grade: string }>(
      `SELECT DISTINCT grade FROM products WHERE grade IS NOT NULL AND grade != '' AND is_active = true ORDER BY grade`
    ),
    queryMany<{ material: string }>(
      `SELECT DISTINCT material FROM products WHERE material IS NOT NULL AND material != '' AND is_active = true ORDER BY material`
    ),
  ])
  return {
    categoryOptions: cats.map(c => ({ value: c.slug, label: c.name })),
    brandOptions: brands.map(b => ({ value: b.id, label: b.name })),
    gradeOptions: grades.map(g => ({ value: g.grade, label: g.grade })),
    materialOptions: materials.map(m => ({ value: m.material, label: m.material })),
  }
}

export async function loadSectionOptions(
  categories: { value: string; label: string }[],
  brands: { value: string; label: string }[]
): Promise<SectionOptions> {
  const [storefront, identity] = await Promise.all([getStorefrontContent(), getStoreIdentity()])
  const { resolveTenantId } = await import('@/lib/tenancy/tenant-context')
  const flagship = isFlagshipTenant(await resolveTenantId().catch(() => null))
  const counts = await queryOne<{
    featured: string
    new_arrivals: string
    best_sellers: string
    on_sale: string
    bundles: string
    approved_reviews: string
  }>(
    `SELECT
       count(*) FILTER (WHERE is_featured = true)          AS featured,
       count(*)                                            AS new_arrivals,
       count(*)                                            AS best_sellers,
       count(*) FILTER (WHERE mrp IS NOT NULL AND mrp > base_price) AS on_sale,
       count(*) FILTER (WHERE is_bundle = true)            AS bundles,
       (SELECT count(*) FROM product_reviews WHERE is_approved = true) AS approved_reviews
     FROM products WHERE is_active = true`
  ).catch(() => null)
  const topCategories = await queryMany<{ id: string; name: string }>(
    `SELECT id, name FROM categories WHERE parent_category_id IS NULL AND is_active = true ORDER BY display_order ASC, name ASC`
  ).catch(() => [] as { id: string; name: string }[])

  return {
    categories,
    brands,
    topCategories: topCategories.map(c => ({ value: c.id, label: c.name })),
    counts: {
      featured: Number(counts?.featured ?? 0),
      newArrivals: Number(counts?.new_arrivals ?? 0),
      bestSellers: Number(counts?.best_sellers ?? 0),
      onSale: Number(counts?.on_sale ?? 0),
      bundles: Number(counts?.bundles ?? 0),
      approvedReviews: Number(counts?.approved_reviews ?? 0),
    },
    // What the storefront shows for empty fields: the flagship's copy, or the neutral one for every other store.
    copyDefaults: {
      ...(flagship ? {} : { why_us: copyDefaultsFor('why_us', false), business_cta: copyDefaultsFor('business_cta', false) }),
      about: { ...(flagship ? {} : copyDefaultsFor('about', false)), subtitle: defaultAboutCopy(storefront.aboutCopy, identity.name) },
    },
    tileDefaults: {
      about: resolveAboutStats(storefront.statsJson, flagship),
      ...(flagship
        ? {}
        : {
            trust_strip: tileDefaultsFor('trust_strip', false) ?? [],
            why_us: tileDefaultsFor('why_us', false) ?? [],
            benefits: tileDefaultsFor('benefits', false) ?? [],
          }),
    },
  }
}
