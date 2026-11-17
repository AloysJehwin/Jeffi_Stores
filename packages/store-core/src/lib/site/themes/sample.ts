import type { SampleCatalog } from '../data/types'
import { SAMPLE_CATALOGS } from './samples/index'

// The sample catalogue a theme previews with, by the store's selling category: samples/<slug>.json, made once by
// scripts/site-themes/generate-samples.ts (names, prices, brands and reviews by the cheap text model, six draft photos).
// Static, so applying a theme costs no AI. Without one, the caller's fallback (the category's starter products), else a
// small generic sample. The store's own details always replace the sample's.

/** 'Electronics & Gadgets' → 'electronics-gadgets' (the sample's file name). */
export const sampleSlug = (category: string) =>
  category
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'other'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** A generated sample, when its file exists and holds a usable catalogue. */
export function generatedSample(category: string | null | undefined): SampleCatalog | null {
  const raw = category ? SAMPLE_CATALOGS[sampleSlug(category)] : null
  if (!isObj(raw) || !Array.isArray(raw.categories) || !Array.isArray(raw.products) || !raw.products.length) return null
  const products = (raw.products as unknown[]).filter((p): p is SampleCatalog['products'][number] => isObj(p) && typeof p.slug === 'string' && typeof p.name === 'string' && typeof p.price === 'number' && typeof p.category === 'string')
  if (!products.length) return null
  return {
    store: { name: '' },
    categories: (raw.categories as SampleCatalog['categories']).filter(c => isObj(c) && typeof c.slug === 'string' && typeof c.name === 'string'),
    brands: Array.isArray(raw.brands) ? (raw.brands as SampleCatalog['brands']).filter(b => isObj(b) && typeof b.slug === 'string' && typeof b.name === 'string') : [],
    products,
    reviews: Array.isArray(raw.reviews) ? (raw.reviews as SampleCatalog['reviews']).filter(r => isObj(r) && typeof r.productSlug === 'string' && typeof r.comment === 'string') : [],
    offers: Array.isArray(raw.offers) ? (raw.offers as NonNullable<SampleCatalog['offers']>).filter(o => isObj(o) && typeof o.title === 'string') : [],
  }
}

const p = (slug: string, name: string, price: number, category: string, extra: Partial<SampleCatalog['products'][number]> = {}): SampleCatalog['products'][number] => ({
  slug,
  name,
  price,
  category,
  brand: 'house-label',
  description: 'A sample product for the preview. Your own products take its place.',
  inStock: true,
  images: [],
  ...extra,
})

/** The last resort: a small catalogue that suits any store. */
export const GENERIC_SAMPLE: SampleCatalog = {
  store: { name: '' },
  categories: [
    { slug: 'new-in', name: 'New in', description: 'The latest additions to the store.', parent: null, image: null },
    { slug: 'best-sellers', name: 'Best sellers', description: 'What customers come back for.', parent: null, image: null },
    { slug: 'everyday', name: 'Everyday', description: 'Things for every day.', parent: null, image: null },
    { slug: 'gifts', name: 'Gifts', description: 'Easy to give, good to get.', parent: null, image: null },
  ],
  brands: [
    { slug: 'house-label', name: 'House Label', featured: true, logo: null },
    { slug: 'studio-line', name: 'Studio Line', featured: true, logo: null },
  ],
  products: [
    p('everyday-essential', 'Everyday Essential', 799, 'everyday', { featured: true, badge: 'Bestseller' }),
    p('signature-classic', 'Signature Classic', 1499, 'best-sellers', { mrp: 1899, featured: true }),
    p('weekend-pick', 'The Weekend Pick', 1199, 'new-in', { badge: 'New', featured: true }),
    p('gift-set', 'Gift Set', 2499, 'gifts', { brand: 'studio-line', featured: true }),
    p('starter-kit', 'Starter Kit', 999, 'new-in', { brand: 'studio-line' }),
    p('travel-edition', 'Travel Edition', 649, 'everyday', { mrp: 799 }),
    p('limited-edition', 'Limited Edition', 2999, 'best-sellers', { brand: 'studio-line', badge: 'New' }),
    p('everyday-duo', 'Everyday Duo', 1349, 'gifts'),
  ],
  reviews: [
    { productSlug: 'everyday-essential', rating: 5, title: 'Just right', comment: 'Exactly as described and well packed.', author: 'Ananya S.' },
    { productSlug: 'signature-classic', rating: 5, title: null, comment: 'Good quality, and it arrived quickly.', author: 'Rohit K.' },
    { productSlug: 'gift-set', rating: 4, title: 'A good gift', comment: 'Bought it as a gift and it went down well.', author: 'Meera P.' },
    { productSlug: 'weekend-pick', rating: 5, title: null, comment: 'Lovely, will order again.', author: 'Arjun N.' },
  ],
  offers: [{ slug: 'offer-1', title: 'New in this week', subtitle: 'Fresh picks across the store', badge: 'New', cta: 'Shop now', image: null, endsAt: null }],
}

/** The catalogue a theme previews with, wearing the store's own details; its offers run for a few more days from now. */
export function themeSample(category: string | null | undefined, store: SampleCatalog['store'], fallback?: SampleCatalog | null): SampleCatalog {
  const base = structuredClone(generatedSample(category) ?? fallback ?? GENERIC_SAMPLE)
  const offers = (base.offers ?? []).map((o, i) => ({ ...o, endsAt: new Date(Date.now() + (3 + i * 4) * 86_400_000).toISOString() }))
  return { ...base, offers, store: { ...store } }
}
