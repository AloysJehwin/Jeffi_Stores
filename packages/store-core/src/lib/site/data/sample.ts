import { offerHref } from '@/lib/catalog/product-offers-shared'
import { money, stars } from './format'
import type { ProductDetailView, ProductQuery, ProductView, SampleCatalog, SiteData } from './types'
import { mapsUrl, phoneUrl } from '@/lib/site/hours'

// A SiteData source over a made-up catalogue, so the onboarding studio can preview a site before the store has
// products. Same filters and sorts as the live queries, in memory.

type SampleProduct = SampleCatalog['products'][number]

const attrs = (a: SampleProduct['attributes']) =>
  Array.isArray(a) ? a.filter(x => x && x.name).map(x => ({ name: String(x.name), value: String(x.value ?? '') })) : Object.entries(a ?? {}).map(([name, value]) => ({ name, value: String(value) }))

// Questions a category page can show before the owner writes its own (no promises the store has not made).
const sampleFaqs = (name: string) => [
  { question: `How do I choose the right ${name}?`, answer: 'Every product lists its details and measurements. Compare a few side by side, or write to us for help choosing.' },
  { question: 'When will my order arrive?', answer: 'Enter your pin code on a product page to see when it can reach you.' },
  { question: `Can I return ${name}?`, answer: "Returns and exchanges follow the store's return policy." },
]

export function sampleSiteData(catalog: SampleCatalog): SiteData {
  const cats = catalog.categories ?? []
  const brands = catalog.brands ?? []
  const reviews = catalog.reviews ?? []
  const catBySlug = new Map(cats.map(c => [c.slug, c]))
  const brandBySlug = new Map(brands.map(b => [b.slug, b]))
  const ratingOf = new Map<string, { sum: number; n: number }>()
  for (const r of reviews) {
    const cur = ratingOf.get(r.productSlug) ?? { sum: 0, n: 0 }
    ratingOf.set(r.productSlug, { sum: cur.sum + r.rating, n: cur.n + 1 })
  }
  const order = new Map((catalog.products ?? []).map((p, i) => [p.slug, i]))

  const subtree = (slug: string) => {
    const out = new Set([slug])
    let grew = true
    while (grew) {
      grew = false
      for (const c of cats) if (c.parent && out.has(c.parent) && !out.has(c.slug)) (out.add(c.slug), (grew = true))
    }
    return out
  }

  // The category and brand pages' views. Sample categories rarely have pictures of their own: their first product's
  // stands in.
  const all = catalog.products ?? []
  const firstPicture = (list: SampleProduct[]) => list.find(p => p.images?.[0])?.images?.[0] ?? null
  const subView = (c: SampleCatalog['categories'][number]) => {
    const tree = subtree(c.slug)
    const list = all.filter(p => tree.has(p.category))
    return { id: `sample-${c.slug}`, slug: c.slug, name: c.name, url: `/categories/${c.slug}`, image: c.image ?? firstPicture(list), productCount: list.length }
  }

  const view = (p: SampleProduct): ProductView => {
    const mrp = p.mrp && p.mrp > p.price ? p.mrp : null
    const pct = mrp ? Math.round(((mrp - p.price) / mrp) * 100) : 0
    const r = ratingOf.get(p.slug)
    const images = (p.images ?? []).filter(Boolean)
    return {
      id: `sample-${p.slug}`,
      slug: p.slug,
      name: p.name,
      url: `/products/${p.slug}`,
      image: images[0] ?? null,
      hoverImage: images[1] ?? null,
      price: money(p.price),
      mrp: mrp ? money(mrp) : null,
      discountPct: pct,
      badge: p.badge ?? (pct >= 5 ? `${pct}% off` : p.featured ? 'Featured' : null),
      brand: p.brand ? (brandBySlug.get(p.brand)?.name ?? null) : null,
      category: catBySlug.get(p.category)?.name ?? null,
      inStock: p.inStock !== false,
      rating: r ? Math.round((r.sum / r.n) * 10) / 10 : null,
      reviewCount: r?.n ?? 0,
      hasVariants: false,
      brandSlug: p.brand ?? null,
      categorySlug: p.category,
      categoryId: p.category ? `sample-${p.category}` : null,
      isDigital: false,
    }
  }

  const SORTS: Record<ProductQuery['sort'], (a: SampleProduct, b: SampleProduct) => number> = {
    featured: (a, b) => Number(!!b.featured) - Number(!!a.featured) || order.get(a.slug)! - order.get(b.slug)!,
    new: (a, b) => order.get(a.slug)! - order.get(b.slug)!,
    best_sellers: (a, b) => (ratingOf.get(b.slug)?.n ?? 0) - (ratingOf.get(a.slug)?.n ?? 0) || order.get(a.slug)! - order.get(b.slug)!,
    price_asc: (a, b) => a.price - b.price,
    price_desc: (a, b) => b.price - a.price,
    discount: (a, b) => ((b.mrp ?? b.price) - b.price) / (b.mrp || 1) - ((a.mrp ?? a.price) - a.price) / (a.mrp || 1),
  }

  return {
    sample: true,
    async products(q) {
      let list = [...(catalog.products ?? [])]
      if (q.category) {
        const tree = subtree(q.category)
        list = list.filter(p => tree.has(p.category))
      }
      if (q.brand) list = list.filter(p => p.brand === q.brand)
      if (q.search) {
        const s = q.search.toLowerCase()
        list = list.filter(p => `${p.name} ${p.description ?? ''}`.toLowerCase().includes(s))
      }
      if (q.minPrice != null) list = list.filter(p => p.price >= q.minPrice!)
      if (q.maxPrice != null) list = list.filter(p => p.price <= q.maxPrice!)
      if (q.onSale) list = list.filter(p => !!p.mrp && p.mrp > p.price)
      if (q.inStock) list = list.filter(p => p.inStock !== false)
      if (q.featured) list = list.filter(p => p.featured)
      if (q.slugs?.length) {
        const at = new Map(q.slugs.map((s, i) => [s, i]))
        list = list.filter(p => at.has(p.slug)).sort((a, b) => at.get(a.slug)! - at.get(b.slug)!)
      } else list.sort(SORTS[q.sort] ?? SORTS.new)
      return list.slice(0, q.limit ?? 8).map(view)
    },
    async product(slug) {
      const p = (catalog.products ?? []).find(x => x.slug === slug)
      if (!p) return null
      const detail: ProductDetailView = {
        ...view(p),
        description: p.description ?? '',
        shortDescription: (p.description ?? '').split(/(?<=\.)\s/)[0] ?? '',
        images: (p.images ?? []).filter(Boolean),
        attributes: attrs(p.attributes),
      }
      return detail
    },
    async categories(q) {
      const list = q.slugs?.length
        ? q.slugs.map(s => catBySlug.get(s)).filter((c): c is NonNullable<typeof c> => !!c)
        : cats.filter(c => (q.parent ? c.parent === q.parent : !c.parent))
      // A category without its own picture shows its first product's, as on the category pages.
      return list.slice(0, q.limit).map(c => ({ id: `sample-${c.slug}`, slug: c.slug, name: c.name, url: `/categories/${c.slug}`, image: subView(c).image }))
    },
    async brands(q) {
      let list = q.slugs?.length ? q.slugs.map(s => brandBySlug.get(s)).filter((b): b is NonNullable<typeof b> => !!b) : brands
      if (q.featured) list = list.filter(b => b.featured)
      return list.slice(0, q.limit).map(b => ({ id: `sample-${b.slug}`, slug: b.slug, name: b.name, url: `/brands/${b.slug}`, logo: b.logo ?? null }))
    },
    async category(slug) {
      const c = catBySlug.get(slug)
      if (!c) return null
      const own = subView(c)
      const parent = c.parent ? catBySlug.get(c.parent) : undefined
      const kids = cats.filter(x => x.parent === slug)
      // Without subcategories of its own, its siblings stand in so the page's design shows.
      const shown = kids.length ? kids : cats.filter(x => x.slug !== slug && (x.parent ?? null) === (c.parent ?? null))
      const lower = c.name.toLowerCase()
      return {
        ...own,
        description: c.description ?? '',
        tagline: c.tagline ?? '',
        mobileImage: own.image,
        bannerUrl: null,
        parentName: parent?.name ?? null,
        parentUrl: parent ? `/categories/${parent.slug}` : null,
        children: shown.map(subView),
        faqs: (c.faqs?.length ? c.faqs : sampleFaqs(lower)).map((f, i) => ({ id: `sample-faq-${i}`, question: f.question, answer: f.answer })),
        seoText: c.seo ?? `A few paragraphs about your ${lower} go here, for shoppers and search engines. You write them in the category's settings.`,
      }
    },
    async brand(slug) {
      const b = brandBySlug.get(slug)
      if (!b) return null
      const list = all.filter(p => p.brand === slug)
      const image = firstPicture(list)
      return {
        id: `sample-${slug}`,
        slug,
        name: b.name,
        url: `/brands/${slug}`,
        logo: b.logo ?? null,
        tagline: b.tagline ?? '',
        description: b.description ?? '',
        story: b.story ?? `The story of ${b.name} goes here: where it comes from, what it makes and why shoppers trust it. You write it in the brand's settings.`,
        website: b.website ?? null,
        color: null,
        image,
        mobileImage: image,
        founded: null,
        headquarters: null,
        origin: null,
        socials: [],
        productCount: list.length,
        seoText: `A few paragraphs about ${b.name} go here, for shoppers and search engines. You write them in the brand's settings.`,
      }
    },
    async allCategories() {
      return cats
        .filter(c => !c.parent)
        .map(c => ({ ...subView(c), tagline: c.tagline ?? '', description: c.description ?? '', children: cats.filter(x => x.parent === c.slug).map(subView) }))
    },
    async allBrands() {
      return [...brands]
        .sort((a, b) => Number(!!b.featured) - Number(!!a.featured))
        .map(b => ({
          id: `sample-${b.slug}`,
          slug: b.slug,
          name: b.name,
          url: `/brands/${b.slug}`,
          logo: b.logo ?? null,
          tagline: b.tagline ?? '',
          description: b.description ?? '',
          productCount: all.filter(p => p.brand === b.slug).length,
          featured: !!b.featured,
        }))
    },
    async reviews(q) {
      const names = new Map((catalog.products ?? []).map(p => [p.slug, p.name]))
      return reviews
        .filter(r => r.rating >= q.minRating && (!q.productSlug || r.productSlug === q.productSlug) && names.has(r.productSlug))
        .sort((a, b) => b.rating - a.rating)
        .slice(0, q.limit)
        .map((r, i) => ({
          id: `sample-review-${i}`,
          rating: r.rating,
          stars: stars(r.rating),
          title: r.title ?? null,
          comment: r.comment,
          author: r.author,
          productName: names.get(r.productSlug) ?? '',
          productSlug: r.productSlug,
          productUrl: `/products/${r.productSlug}`,
        }))
    },
    async offers(q) {
      return (catalog.offers ?? []).slice(0, q.limit).map(o => ({
        id: `sample-${o.slug}`,
        slug: o.slug,
        title: o.title,
        subtitle: o.subtitle ?? null,
        badge: o.badge ?? null,
        image: o.image ?? null,
        mobileImage: null,
        url: offerHref(o.slug),
        cta: o.cta ?? null,
        endsAt: o.endsAt ?? null,
      }))
    },
    async store() {
      const s = catalog.store ?? { name: 'Your store' }
      return {
        name: s.name,
        tagline: s.tagline ?? '',
        logo: s.logo ?? null,
        email: s.email ?? '',
        phone: s.phone ?? '',
        address: s.address ?? '',
        about: s.about ?? '',
        year: new Date().getFullYear(),
        ...(s.whatsapp ? { whatsapp: s.whatsapp } : {}),
        ...(s.socials && Object.keys(s.socials).length ? { socials: s.socials } : {}),
        hours: [],
        phoneUrl: phoneUrl(s.phone ?? ''),
        mapsUrl: mapsUrl(s.address ?? ''),
      }
    },
  }
}
