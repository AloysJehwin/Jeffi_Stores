import type { ReactNode } from 'react'
import Link from 'next/link'
import type { PageKey } from '@jeffi/site-blocks'
import { MAX_EACH, safeSrc } from '@/lib/site/code/allow'
import type { RenderCtx } from '@/lib/site/code/registry'
import type { BrandIndexView, BrandPageView, CategoryIndexView, CategoryPageView, SearchView, SiteData, SubCategoryView } from '@/lib/site/data/types'
import { responsiveImg } from '@/lib/shared/image-url'
import { faqJsonLd } from '@/components/visitor/pdp/ProductInfoSections'
import { Paragraphs } from '@/components/visitor/brand/BrandProfile'
import Accordion, { AccordionItem } from '../../islands/Accordion'
import { CategoryTile, CodeImage, CodeLink, ItemsLayout } from '../../common/tiles'
import { listingParts } from '../listing/context'
import { indexPage } from './context'

// The catalogue pages' parts: the category or brand page's own record, its subcategories, FAQs and SEO copy, the
// breadcrumbs, the search term, and every category or brand for the index pages. On a live page they read what the
// route loaded (its listing parts, or the index page); off one (the studio preview) the catalogue's first category or
// brand stands in.

/** Entries an index list draws at most (a store's every brand, not a slice of them). */
const MAX_INDEX = 120

type Layout = 'grid' | 'carousel' | 'list' | 'mosaic'
const own = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined)
const layoutOf = (v: unknown): Layout => (v === 'carousel' || v === 'list' || v === 'mosaic' ? v : 'grid')
const plural = (n: number) => `${n} ${n === 1 ? 'product' : 'products'}`
const wrap = (className: string | undefined, body: ReactNode) => (className ? <div className={className}>{body}</div> : body)

/** The category page's category; off a listing page, the catalogue's first top-level category. */
export async function currentCategory(data: SiteData): Promise<CategoryPageView | null> {
  const d = listingParts()
  if (d) return d.category ?? null
  const [first] = await data.categories({ parent: null, limit: 1 })
  return first ? data.category(first.slug) : null
}

/** The brand page's brand; off a listing page, the catalogue's first brand. */
export async function currentBrand(data: SiteData): Promise<BrandPageView | null> {
  const d = listingParts()
  if (d) return d.brand ?? null
  const [first] = await data.brands({ limit: 1 })
  return first ? data.brand(first.slug) : null
}

/** The search page's query; off a listing page, a search for the first category's name. */
export async function currentSearch(data: SiteData): Promise<SearchView | null> {
  const d = listingParts()
  if (d) return d.search ?? null
  const c = await currentCategory(data)
  return c ? { term: c.name.toLowerCase(), total: c.productCount } : null
}

/** The category's or brand's SEO copy: the live page's own, else the preview page's sample. */
export async function seoCopy(data: SiteData, page: PageKey | null): Promise<string> {
  const d = listingParts()
  if (d) return d.category?.seoText || d.brand?.seoText || ''
  return (page === 'brand' ? (await currentBrand(data))?.seoText : (await currentCategory(data))?.seoText) ?? ''
}

/** A hero or banner picture: the phone picture under 768px, linked when it has a link. */
function Hero({ desktop, mobile, alt, href, priority }: { desktop: string | null; mobile: string | null; alt: string; href?: string | null; priority: boolean }) {
  const src = safeSrc(mobile) ?? safeSrc(desktop)
  if (!src) return null
  const wide = safeSrc(desktop)
  const pic = (
    <picture>
      {wide && wide !== src && <source media="(min-width: 768px)" srcSet={wide} />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        {...(priority ? ({ loading: 'eager', fetchPriority: 'high' } as const) : ({ loading: 'lazy' } as const))}
        decoding="async"
        className="w-full max-h-72 object-cover rounded-xl border border-border-default"
      />
    </picture>
  )
  return href ? (
    <CodeLink href={href} target={href.startsWith('/') ? undefined : '_blank'} className="block">
      {pic}
    </CodeLink>
  ) : (
    pic
  )
}

const HEADING = 'font-display text-3xl md:text-4xl font-bold text-foreground'

export async function renderCategory(ctx: RenderCtx, props: Record<string, unknown>): Promise<ReactNode> {
  const c = await currentCategory(ctx.data)
  if (!c) return null
  const className = own(props.className)
  if (ctx.renderItem) return wrap(className, ctx.renderItem(c))
  if (ctx.children) return wrap(className, ctx.children)
  const picture = !!(c.image || c.mobileImage)
  return (
    <div className={className ?? 'container mx-auto px-4 py-6 sm:py-8'}>
      <h1 className={HEADING}>{c.name}</h1>
      {c.tagline && <p className="mt-1 text-lg font-medium text-foreground">{c.tagline}</p>}
      {c.description && <p className="mt-2 max-w-3xl text-foreground-secondary">{c.description}</p>}
      {picture && (
        <div className="mt-4 sm:mt-6">
          <Hero desktop={c.image} mobile={c.mobileImage} alt={c.name} href={c.bannerUrl} priority={ctx.claimPriority()} />
        </div>
      )}
    </div>
  )
}

export async function renderBrand(ctx: RenderCtx, props: Record<string, unknown>): Promise<ReactNode> {
  const b = await currentBrand(ctx.data)
  if (!b) return null
  const className = own(props.className)
  if (ctx.renderItem) return wrap(className, ctx.renderItem(b))
  if (ctx.children) return wrap(className, ctx.children)
  const logo = safeSrc(b.logo)
  const links = [...(b.website ? [{ label: b.website.replace(/^https:\/\/(www\.)?/i, '').replace(/\/$/, ''), href: b.website }] : []), ...b.socials.map(s => ({ label: s.label, href: s.href }))]
  return (
    <div className={className ?? 'container mx-auto px-4 py-6 sm:py-8'}>
      <div className="flex items-center gap-4">
        {logo && (
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border-default bg-surface-secondary">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img {...responsiveImg(logo, '64px')} alt={b.name} decoding="async" className="h-full w-full object-contain p-1" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className={HEADING}>{b.name}</h1>
          {b.tagline && <p className="mt-1 text-lg font-medium text-foreground">{b.tagline}</p>}
        </div>
      </div>
      {b.description && <p className="mt-3 max-w-3xl text-foreground-secondary">{b.description}</p>}
      {links.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2 text-sm">
          {links.map(l => (
            <li key={l.href}>
              <a href={l.href} target="_blank" rel="noopener noreferrer" className="inline-block rounded-full border border-border-default bg-surface-secondary px-3 py-1 text-foreground-secondary hover:border-accent-500 hover:text-accent-600">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      {(b.image || b.mobileImage) && (
        <div className="mt-4 sm:mt-6">
          <Hero desktop={b.image} mobile={b.mobileImage} alt={b.name} priority={ctx.claimPriority()} />
        </div>
      )}
    </div>
  )
}

export async function renderSearchQuery(ctx: RenderCtx, props: Record<string, unknown>): Promise<ReactNode> {
  const q = await currentSearch(ctx.data)
  if (!q) return null
  const className = own(props.className)
  if (ctx.renderItem) return wrap(className, ctx.renderItem(q))
  return (
    <div className={className ?? 'container mx-auto px-4 pt-6'}>
      <h1 className="font-display text-2xl md:text-3xl font-bold text-foreground">{`Results for “${q.term}”`}</h1>
      <p className="mt-1 text-sm text-foreground-muted">{plural(q.total)}</p>
    </div>
  )
}

export type Crumb = { name: string; url: string | null; current: boolean }

/** The page's trail, from what the route mounted (a listing or an index page), else the page the preview shows. */
export async function crumbsFor(ctx: RenderCtx): Promise<Crumb[]> {
  const kind = listingParts()?.kind ?? indexPage() ?? ctx.page
  const trail: { name: string; url: string }[] = [{ name: 'Home', url: '/' }]
  switch (kind) {
    case 'category': {
      const c = await currentCategory(ctx.data)
      trail.push({ name: 'Categories', url: '/categories' })
      if (c?.parentName && c.parentUrl) trail.push({ name: c.parentName, url: c.parentUrl })
      if (c) trail.push({ name: c.name, url: c.url })
      break
    }
    case 'brand': {
      const b = await currentBrand(ctx.data)
      trail.push({ name: 'Brands', url: '/brands' })
      if (b) trail.push({ name: b.name, url: b.url })
      break
    }
    case 'search': {
      const q = await currentSearch(ctx.data)
      trail.push({ name: 'Products', url: '/products' })
      if (q) trail.push({ name: `Results for “${q.term}”`, url: '' })
      break
    }
    case 'products':
      trail.push({ name: 'All products', url: '/products' })
      break
    case 'categories':
      trail.push({ name: 'Categories', url: '/categories' })
      break
    case 'brands':
      trail.push({ name: 'Brands', url: '/brands' })
      break
    default:
      return []
  }
  return trail.map((t, i) => (i === trail.length - 1 ? { name: t.name, url: null, current: true } : { name: t.name, url: t.url, current: false }))
}

export async function renderBreadcrumbs(ctx: RenderCtx, props: Record<string, unknown>): Promise<ReactNode> {
  const crumbs = await crumbsFor(ctx)
  if (crumbs.length < 2) return null
  const className = own(props.className)
  if (ctx.renderItem) {
    const render = ctx.renderItem
    return (
      <nav aria-label="Breadcrumb" className={className}>
        {crumbs.map((c, i) => render(c, i))}
      </nav>
    )
  }
  return (
    <nav aria-label="Breadcrumb" className={className ?? 'text-sm'}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {crumbs.map((c, i) => (
          <li key={i} className="flex items-center gap-2">
            {i > 0 && (
              <span aria-hidden className="text-foreground-muted">
                /
              </span>
            )}
            {c.url ? (
              <Link href={c.url} className="text-foreground-muted hover:text-accent-500">
                {c.name}
              </Link>
            ) : (
              <span aria-current="page" className="font-medium text-foreground">
                {c.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

function SubCategoryChip({ s }: { s: SubCategoryView }) {
  const img = safeSrc(s.image)
  return (
    <Link
      href={s.url}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border-default bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-accent-500 hover:text-accent-600"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {img && <img {...responsiveImg(img, '28px')} alt="" loading="lazy" decoding="async" className="h-7 w-7 rounded-full object-cover" />}
      <span>{s.name}</span>
      {s.productCount > 0 && <span className="text-xs text-foreground-muted">{s.productCount}</span>}
    </Link>
  )
}

export async function renderSubCategories(ctx: RenderCtx, props: Record<string, unknown>): Promise<ReactNode> {
  const list = ((await currentCategory(ctx.data))?.children ?? []).slice(0, MAX_EACH)
  if (!list.length) return null
  const tiles = props.variant === 'tiles'
  return (
    <ItemsLayout
      layout={layoutOf(props.layout)}
      className={own(props.className)}
      itemClassName={own(props.itemClassName)}
      label="Subcategories"
      fallbackGrid={tiles ? 'grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6' : 'flex flex-wrap gap-2'}
    >
      {list.map((s, i) => (ctx.renderItem ? ctx.renderItem(s, i) : tiles ? <CategoryTile key={s.id} c={s} priority={false} fill={props.layout === 'mosaic'} /> : <SubCategoryChip key={s.id} s={s} />))}
    </ItemsLayout>
  )
}

export async function renderCategoryFaqs(ctx: RenderCtx, props: Record<string, unknown>): Promise<ReactNode> {
  const faqs = ((await currentCategory(ctx.data))?.faqs ?? []).slice(0, MAX_EACH)
  if (!faqs.length) return null
  // The live page's questions go to search engines too, as the built-in block's do.
  const ld = listingParts()?.category ? faqJsonLd(faqs) : null
  const script = ld ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} /> : null
  const className = own(props.className)
  if (ctx.renderItem) {
    const render = ctx.renderItem
    const items = faqs.map((f, i) => render({ question: f.question, answer: f.answer }, i))
    return (
      <>
        {script}
        {wrap(className, items)}
      </>
    )
  }
  return (
    <>
      {script}
      <Accordion defaultOpen={props.defaultOpen === true} className={className}>
        {faqs.map((f, i) => (
          <AccordionItem key={f.id} title={f.question} first={i === 0}>
            <p className="whitespace-pre-line">{f.answer}</p>
          </AccordionItem>
        ))}
      </Accordion>
    </>
  )
}

export async function renderSeoText(ctx: RenderCtx, props: Record<string, unknown>): Promise<ReactNode> {
  const text = await seoCopy(ctx.data, ctx.page)
  if (!text) return null
  const className = own(props.className)
  if (ctx.renderItem) {
    const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
    return wrap(className, ctx.renderItem({ text, paragraphs }))
  }
  return <Paragraphs text={text} className={className ?? 'max-w-3xl text-sm'} />
}

function CategoryIndexCard({ c, priority }: { c: CategoryIndexView; priority: boolean }) {
  return (
    <Link href={c.url} className="group block h-full overflow-hidden rounded-[var(--radius-card,0.75rem)] border border-border-default bg-surface-elevated transition-shadow hover:shadow-lg">
      {safeSrc(c.image) && <CodeImage src={c.image} alt={c.name} aspect="16:9" sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" priority={priority} />}
      <div className="p-4 sm:p-6">
        <h2 className="text-xl font-bold text-foreground transition-colors group-hover:text-accent-600">{c.name}</h2>
        {c.tagline && <p className="mt-0.5 text-sm text-foreground-secondary">{c.tagline}</p>}
        <p className="mt-1 text-sm text-foreground-muted">{plural(c.productCount)}</p>
        {c.description && <p className="mt-3 line-clamp-2 text-sm text-foreground-secondary">{c.description}</p>}
        {c.children.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border-default pt-4">
            {c.children.slice(0, 5).map(s => (
              <span key={s.id} className="rounded bg-surface-secondary px-2 py-1 text-xs text-foreground-secondary">
                {s.name}
              </span>
            ))}
            {c.children.length > 5 && <span className="text-xs font-medium text-accent-600">+{c.children.length - 5} more</span>}
          </div>
        )}
      </div>
    </Link>
  )
}

function BrandIndexCard({ b }: { b: BrandIndexView }) {
  const logo = safeSrc(b.logo)
  return (
    <Link href={b.url} className="group flex h-full items-start gap-4 rounded-[var(--radius-card,0.75rem)] border border-border-default bg-surface-elevated p-4 transition-shadow hover:shadow-lg sm:p-6">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border-default bg-surface-secondary">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img {...responsiveImg(logo, '64px')} alt={b.name} loading="lazy" decoding="async" className="h-full w-full object-contain p-1" />
        ) : (
          <span aria-hidden className="font-display text-2xl font-bold text-foreground-muted">
            {b.name.slice(0, 1)}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <h2 className="text-xl font-bold text-foreground transition-colors group-hover:text-accent-600">{b.name}</h2>
        {b.tagline && <p className="mt-0.5 text-sm text-foreground-secondary">{b.tagline}</p>}
        <p className="mt-1 text-sm text-foreground-muted">{plural(b.productCount)}</p>
        {b.description && <p className="mt-2 line-clamp-2 text-sm text-foreground-secondary">{b.description}</p>}
      </div>
    </Link>
  )
}

const INDEX_GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3'

export async function renderAllCategories(ctx: RenderCtx, props: Record<string, unknown>): Promise<ReactNode> {
  const list = (await ctx.data.allCategories()).slice(0, MAX_INDEX)
  if (!list.length) return null
  return (
    <ItemsLayout layout={layoutOf(props.layout)} className={own(props.className)} itemClassName={own(props.itemClassName)} label="Categories" fallbackGrid={INDEX_GRID}>
      {list.map((c, i) => (ctx.renderItem ? ctx.renderItem(c, i) : <CategoryIndexCard key={c.id} c={c} priority={i === 0 && !!safeSrc(c.image) && ctx.claimPriority()} />))}
    </ItemsLayout>
  )
}

export async function brandIndex(data: SiteData, featured: boolean): Promise<BrandIndexView[]> {
  const list = await data.allBrands()
  return (featured ? list.filter(b => b.featured) : list).slice(0, MAX_INDEX)
}

export async function renderAllBrands(ctx: RenderCtx, props: Record<string, unknown>): Promise<ReactNode> {
  const list = await brandIndex(ctx.data, props.featured === true)
  if (!list.length) return null
  return (
    <ItemsLayout layout={layoutOf(props.layout)} className={own(props.className)} itemClassName={own(props.itemClassName)} label="Brands" fallbackGrid={INDEX_GRID}>
      {list.map((b, i) => (ctx.renderItem ? ctx.renderItem(b, i) : <BrandIndexCard key={b.id} b={b} />))}
    </ItemsLayout>
  )
}
