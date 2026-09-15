export type SectionType =
  | 'hero'
  | 'trust_strip'
  | 'category_grid'
  | 'brand_carousel'
  | 'product_row'
  | 'category_showcase'
  | 'deal_of_the_day'
  | 'promo_banner'
  | 'featured_for_you'
  | 'benefits'
  | 'why_us'
  | 'about'
  | 'business_cta'

export const SECTION_TYPES: SectionType[] = [
  'hero', 'trust_strip', 'category_grid', 'brand_carousel', 'product_row',
  'category_showcase', 'deal_of_the_day', 'promo_banner', 'featured_for_you',
  'benefits', 'why_us', 'about', 'business_cta',
]

/** Which query backs a product_row. Collapses the separate featured/new/best-seller fetches. */
export type ProductSource = 'featured' | 'new_arrivals' | 'best_sellers' | 'on_sale' | 'category'

export type SectionLayout = 'grid' | 'carousel'

export interface HomepageSection {
  id: string
  type: SectionType
  title: string | null
  subtitle: string | null
  eyebrow: string | null
  cta_label: string | null
  cta_url: string | null
  config: Record<string, unknown>
  display_order: number
  is_active: boolean
  starts_at: string | null
  ends_at: string | null
}

export interface SectionMeta {
  label: string
  description: string
  /** A singleton may only appear once on the page. */
  singleton?: boolean
}

export const SECTION_META: Record<SectionType, SectionMeta> = {
  hero:              { label: 'Hero slides',      description: 'Full-width rotating banner at the top of the page.', singleton: true },
  trust_strip:       { label: 'Trust strip',      description: 'Row of delivery, returns and payment reassurances.' },
  category_grid:     { label: 'Shop by category', description: 'Grid or carousel of top-level categories.' },
  brand_carousel:    { label: 'Shop by brand',    description: 'Grid or carousel of brands you stock.' },
  product_row:       { label: 'Product row',      description: 'Featured, new arrivals, best sellers, on sale, or one category.' },
  category_showcase: { label: 'Category showcase', description: 'Large category cards with product thumbnails.' },
  deal_of_the_day:   { label: 'Deal of the day',  description: 'A small set of highlighted offers.' },
  promo_banner:      { label: 'Promo banner',     description: 'Seasonal or sale banner. Supports a start and end date.' },
  featured_for_you:  { label: 'Featured for you', description: 'Personalised picks. Hidden for signed-out visitors.', singleton: true },
  benefits:          { label: 'Benefits',         description: 'Why-shop-with-us tiles.' },
  why_us:            { label: 'Why us',           description: 'Three larger cards explaining what sets the store apart.', singleton: true },
  about:             { label: 'About',            description: 'Store story with stats.', singleton: true },
  business_cta:      { label: 'Business CTA',     description: 'Banner promoting the B2B/bulk experience.', singleton: true },
}

const DEFAULT_LIMITS: Partial<Record<SectionType, number>> = {
  category_grid: 8,
  brand_carousel: 8,
  category_showcase: 4,
  deal_of_the_day: 4,
}

export function sectionLimit(section: Pick<HomepageSection, 'type' | 'config'>, fallback?: number): number {
  const raw = section.config?.limit
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  if (Number.isFinite(n) && n > 0) return n
  return fallback ?? DEFAULT_LIMITS[section.type] ?? 8
}

export function sectionLayout(section: Pick<HomepageSection, 'config'>): SectionLayout {
  return section.config?.layout === 'carousel' ? 'carousel' : 'grid'
}

export function productSource(section: Pick<HomepageSection, 'config'>): ProductSource {
  const s = section.config?.source
  return s === 'new_arrivals' || s === 'best_sellers' || s === 'on_sale' || s === 'category'
    ? s
    : 'featured'
}

/** Cache key so two rows with identical settings cost one query. */
export function productRowKey(section: Pick<HomepageSection, 'config'>, limit: number): string {
  const categorySlug = typeof section.config?.categorySlug === 'string' ? section.config.categorySlug : ''
  return `${productSource(section)}:${limit}:${categorySlug}`
}

// Scheduling is evaluated here rather than in SQL: a SQL NOW() would be frozen into the
// page's ISR cache entry and never re-evaluate.
export function isWithinWindow(section: Pick<HomepageSection, 'starts_at' | 'ends_at'>, now = Date.now()): boolean {
  if (section.starts_at && now < Date.parse(section.starts_at)) return false
  if (section.ends_at && now > Date.parse(section.ends_at)) return false
  return true
}

export function visibleSections(sections: HomepageSection[], now = Date.now()): HomepageSection[] {
  return sections
    .filter(s => s.is_active && isWithinWindow(s, now))
    .sort((a, b) => a.display_order - b.display_order)
}

type DefaultSection = Omit<HomepageSection, 'id' | 'is_active' | 'starts_at' | 'ends_at'>

const d = (
  type: SectionType,
  display_order: number,
  extra: Partial<Omit<DefaultSection, 'type' | 'display_order'>> = {},
): DefaultSection => ({
  type,
  title: null,
  subtitle: null,
  eyebrow: null,
  cta_label: null,
  cta_url: null,
  config: {},
  display_order,
  ...extra,
})

// Reproduces the hardcoded page order exactly, so a store with no configured sections
// renders an identical homepage.
export const DEFAULT_SECTIONS: DefaultSection[] = [
  d('hero', 0),
  d('trust_strip', 1),
  d('category_grid', 2, { title: 'Shop by Category', eyebrow: 'Browse' }),
  d('product_row', 3, { title: 'Featured Products', eyebrow: 'Handpicked', config: { source: 'featured' } }),
  d('brand_carousel', 4, { title: 'Shop by Brand', eyebrow: 'Trusted Names' }),
  d('product_row', 5, { title: 'New Arrivals', eyebrow: 'Just In', config: { source: 'new_arrivals' } }),
  d('category_showcase', 6, { title: 'Shop by Category', eyebrow: 'Explore' }),
  d('featured_for_you', 7),
  d('product_row', 8, { title: 'Best Sellers', eyebrow: 'Popular', config: { source: 'best_sellers' } }),
  d('benefits', 9),
  d('why_us', 10, { title: 'Built for Industry', eyebrow: 'Why us' }),
  d('about', 11),
  d('business_cta', 12),
]

export function withDefaults(rows: HomepageSection[]): HomepageSection[] {
  if (rows.length > 0) return rows
  return DEFAULT_SECTIONS.map((s, i) => ({
    ...s,
    id: `default-${i}`,
    is_active: true,
    starts_at: null,
    ends_at: null,
  }))
}
