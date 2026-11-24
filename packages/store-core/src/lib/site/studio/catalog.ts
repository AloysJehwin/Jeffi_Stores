import type { SampleCatalog } from '../data/types'
import { pictureFor, searchTerms } from '@/lib/ai/stock'
import { askJson, listOf, orNull, pick, rng, shuffle, str, studioBudgetLeft } from './ai'
import type { StudioBrief } from './types'

// The sample catalogue the studio previews the site with: categories, 12-24 believable products in INR with
// attributes, brands, a few reviews and offers. Provisioning seeds it into the new store (provisioning/seed.ts), so the
// owner starts from it. Each product gets a photo (addPictures: a stock photo, else one made within the budget); without
// one the Image component draws a placeholder.

type Product = SampleCatalog['products'][number]

const MIN_PRODUCTS = 12
const MAX_PRODUCTS = 24
const PRICE: Record<StudioBrief['priceTier'], [number, number]> = { value: [149, 1499], mid: [499, 4999], premium: [1499, 14999], luxury: [7999, 89999] }
const NAMES = ['Ananya S.', 'Rohit K.', 'Meera P.', 'Arjun N.', 'Kavya R.', 'Farhan A.', 'Lakshmi V.', 'Ishaan M.', 'Priya D.', 'Sandeep G.']

// 'Home Décor' → 'home-decor': NFKD splits off the accent, which is then dropped (not turned into a hyphen).
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item'

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

// A price that reads like a shop's: 1,299 not 1,312.
const shopPrice = (n: number) => (n < 1000 ? Math.round(n / 10) * 10 - 1 : Math.round(n / 100) * 100 - 1)

function attributes(v: unknown): Record<string, string> {
  if (Array.isArray(v)) return Object.fromEntries(v.filter(x => x && typeof x === 'object' && (x as { name?: unknown }).name).slice(0, 6).map(x => [String((x as { name: unknown }).name).slice(0, 40), String((x as { value?: unknown }).value ?? '').slice(0, 80)]))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 6).map(([k, x]) => [k.slice(0, 40), String(x).slice(0, 80)]))
  return {}
}

/** Fills a thin or failed answer: products named from the brief's vocabulary, priced for its tier. */
function fallbackProducts(b: StudioBrief, cats: SampleCatalog['categories'], n: number, taken: Set<string>): Product[] {
  const r = rng(b.seed, 'catalog')
  const words = b.vocabulary.length ? b.vocabulary : [b.category || 'Classic', 'Signature', 'Everyday']
  const adj = ['Classic', 'Signature', 'Handpicked', 'Everyday', 'Heritage', 'Festive', 'Essential', 'Limited', 'Studio', 'Artisan']
  const [lo, hi] = PRICE[b.priceTier]
  const out: Product[] = []
  for (let i = 0; out.length < n && i < n * 4; i++) {
    const name = `${pick(r, adj)} ${pick(r, words)}`.replace(/\b\w/g, c => c.toUpperCase()).slice(0, 80)
    const slug = slugify(name)
    if (taken.has(slug)) continue
    taken.add(slug)
    const price = shopPrice(lo + r() * (hi - lo))
    const cat = cats[i % cats.length]
    out.push({ slug, name, price, mrp: r() < 0.4 ? shopPrice(price * (1.2 + r() * 0.4)) : null, category: cat.slug, description: `${name} from the ${cat.name} range.`, attributes: {}, imagePrompt: `${name}, ${b.category}`, photoQuery: searchTerms(b.category || name) })
  }
  return out
}

export async function sampleCatalog(b: StudioBrief, opts: { images?: number } = {}): Promise<SampleCatalog> {
  const out =
    studioBudgetLeft() > 0
      ? await askJson(
          `You make a believable sample catalogue for a new Indian online store, used only to preview its website design (the owner's real products replace it). Realistic product names in the store's vocabulary, prices in INR fitting the price tier, real-sounding attributes (material, size, weight, care, origin as fits the category).
Return JSON {"tagline": short, "about": two sentences, "categories": [4-6 {"name", "description"}], "brands": [2-5 {"name"}] (the store's own label counts), "products": [16-20 {"name", "price": number, "mrp": number or null (higher than price when on sale), "category": a category name, "brand": a brand name or null, "description": one or two sentences, "attributes": {"Material": "…", …}, "badge": "New"|"Bestseller"|null, "imagePrompt": a product photo description, "photoQuery": a 2-4 word stock-photo search for this kind of product, e.g. "silk saree" or "brass diya"}], "reviews": [6 {"product": a product name, "rating": 4-5, "title", "comment": one or two sentences, "author": Indian first name and initial}], "offers": [1-2 {"title", "subtitle", "badge", "cta"}]}.`,
          `Store: ${b.storeName}. ${b.summary} Sells ${b.category} to ${b.audience}. Price tier ${b.priceTier}. Words: ${b.vocabulary.join(', ')}. Voice: ${b.voice}.`,
          { maxTokens: 6000, temperature: 0.8, modelHint: 'copy' }
        ).catch(orNull)
      : null

  const r = rng(b.seed, 'catalog-fill')
  const catList = listOf(out, 'categories')
    .map(c => (c && typeof c === 'object' ? (c as Record<string, unknown>) : { name: c }))
    .map(c => ({ name: str(c.name ?? c.title, 60), description: str(c.description, 200) }))
    .filter(c => c.name)
  const cats: SampleCatalog['categories'] = (catList.length ? catList : (b.vocabulary.length ? b.vocabulary : ['New in', 'Best sellers', 'Gifts']).slice(0, 4).map(name => ({ name, description: '' })))
    .slice(0, 8)
    .map(c => ({ slug: slugify(c.name), name: c.name, description: c.description || undefined, parent: null, image: null }))
  const catSlug = (v: unknown) => {
    const s = slugify(String(v ?? ''))
    return cats.find(c => c.slug === s || c.name.toLowerCase() === String(v ?? '').toLowerCase())?.slug ?? pick(r, cats).slug
  }
  const brandNames = listOf(out, 'brands').map(x => str(x && typeof x === 'object' ? (x as Record<string, unknown>).name : x, 60)).filter(Boolean)
  const brands: SampleCatalog['brands'] = (brandNames.length ? brandNames : [b.storeName]).slice(0, 6).map((name, i) => ({ slug: slugify(name), name, featured: i < 3, logo: null }))
  const brandSlug = (v: unknown) => (v ? brands.find(x => x.slug === slugify(String(v)))?.slug ?? null : null)

  const taken = new Set<string>()
  const [lo, hi] = PRICE[b.priceTier]
  const products: Product[] = []
  for (const raw of listOf(out, 'products', 'items')) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const name = str(o.name ?? o.title, 90)
    const slug = slugify(name)
    if (!name || taken.has(slug)) continue
    taken.add(slug)
    const price = num(o.price) ?? shopPrice(lo + r() * (hi - lo))
    const mrp = num(o.mrp)
    products.push({
      slug,
      name,
      price,
      mrp: mrp && mrp > price ? mrp : null,
      category: catSlug(o.category),
      brand: brandSlug(o.brand),
      description: str(o.description, 400),
      attributes: attributes(o.attributes ?? o.specs),
      badge: str(o.badge, 20) || null,
      featured: products.length < 4,
      inStock: true,
      images: [],
      imagePrompt: str(o.imagePrompt ?? o.image_prompt, 300, `${name}, ${b.category}`),
      photoQuery: searchTerms(str(o.photoQuery ?? o.photo_query, 80)) || searchTerms(name),
    })
    if (products.length >= MAX_PRODUCTS) break
  }
  if (products.length < MIN_PRODUCTS) products.push(...fallbackProducts(b, cats, MIN_PRODUCTS - products.length, taken))

  const bySlugOrName = (v: unknown) => products.find(p => p.slug === slugify(String(v ?? '')) || p.name.toLowerCase() === String(v ?? '').toLowerCase())?.slug
  let reviews: SampleCatalog['reviews'] = listOf(out, 'reviews')
    .map(x => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
    .map(x => ({ productSlug: bySlugOrName(x.product ?? x.productSlug ?? x.productName) ?? pick(r, products).slug, rating: Math.max(1, Math.min(5, Math.round(Number(x.rating) || 5))), title: str(x.title, 80) || null, comment: str(x.comment ?? x.text, 400), author: str(x.author ?? x.name, 40, pick(r, NAMES)) }))
    .filter(x => x.comment)
    .slice(0, 10)
  if (reviews.length < 3) {
    reviews = shuffle(r, products).slice(0, 4).map((p, i) => ({ productSlug: p.slug, rating: i === 3 ? 4 : 5, title: null, comment: `Lovely ${p.name.toLowerCase()}, just as described and well packed.`, author: NAMES[i] }))
  }
  const offers = listOf(out, 'offers')
    .map(x => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
    .map((x, i) => ({ slug: `offer-${i + 1}`, title: str(x.title, 80), subtitle: str(x.subtitle, 160) || null, badge: str(x.badge, 20) || null, cta: str(x.cta, 30) || 'Shop now', image: null, endsAt: new Date(Date.now() + (3 + i * 4) * 86_400_000).toISOString() }))
    .filter(x => x.title)
    .slice(0, 3)

  const catalog: SampleCatalog = {
    // The owner's own details from the onboarding Store step, so the preview shows the real contacts.
    store: { name: b.storeName, tagline: b.tagline || str(out?.tagline, 120) || b.summary.slice(0, 120), logo: b.logoUrl, about: b.about || str(out?.about, 600) || b.summary, email: b.contact?.email ?? '', phone: b.contact?.phone ?? '', address: b.contact?.address ?? '', ...(b.contact?.whatsapp ? { whatsapp: b.contact.whatsapp } : {}), ...(b.socials ? { socials: b.socials } : {}) },
    categories: cats,
    brands,
    products,
    reviews,
    offers,
  }
  if (opts.images) await addPictures(catalog, b, opts.images)
  return catalog
}

/** Photos made at once: one product after another would take minutes for a full catalogue. */
const PICTURE_WORKERS = 4

/**
 * A photo for each sample product without one (at most `max`): a stock photo (credited) when one is found, else one
 * made in the brief's art direction while the budget lasts (`ai: false` skips making any). After the first generation
 * failure the rest are stock only, and it says why; returns how many were added.
 */
export async function addPictures(catalog: SampleCatalog, b: StudioBrief, max: number, opts: { ai?: boolean } = {}): Promise<{ made: number; error?: string }> {
  const todo = catalog.products.filter(p => !p.images?.length && p.imagePrompt)
  const used = new Set<string>()
  let made = 0
  let running = 0
  let error: string | undefined
  const worker = async () => {
    while (todo.length && made + running < max) {
      const p = todo.shift()!
      running++
      try {
        const pic = await pictureFor({
          stock: { queries: [p.photoQuery || p.name], shape: 'square', seed: b.seed, used, skipGallery: true },
          ai:
            error || opts.ai === false
              ? null
              : {
                  prompt: `${p.imagePrompt}. Product photograph for an online store. ${b.artDirection}. No text, no logos, no watermarks.`,
                  negativePrompt: 'text, letters, watermark, logo, distorted hands',
                  width: 1024,
                  height: 1024,
                  feature: 'homepage_image',
                  // Site generation always uses the cheapest image model.
                  quality: 'draft',
                  ref: 'site-studio:sample',
                  skipGallery: true,
                },
          aiAllowed: () => studioBudgetLeft() > 0,
        })
        if (pic) {
          p.images = [pic.url]
          if (pic.credit) p.imageCredit = pic.credit
          made++
        }
      } catch (err) {
        error ??= (err as Error)?.message?.slice(0, 400) || 'image generation failed'
      } finally {
        running--
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PICTURE_WORKERS, todo.length) }, worker))
  return error ? { made, error } : { made }
}
