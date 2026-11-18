import Link from 'next/link'
import type { ReactNode } from 'react'
import { Award, Check, Clock, Gift, Heart, Leaf, MapPin, Package, Percent, Phone, RefreshCw, Shield, Sparkles, Star, Tag, Truck, type LucideIcon } from 'lucide-react'
import ProductCard from '@/components/visitor/ProductCard'
import SectionCarousel from '@/components/visitor/SectionCarousel'
import Reveal from '@/components/visitor/home/Reveal'
import { productCardProps } from '@/lib/catalog/product-card-props'
import { offerHref, type ProductOffer } from '@/lib/catalog/product-offers-shared'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { responsiveImg } from '@/lib/shared/image-url'
import { cleanTree, type ComposedNode, type NodeOf } from '@/lib/site/composed'
import { loadComposedData, type BrandTile, type CategoryTile, type ComposedData, type ReviewQuote } from '@/lib/site/composed-data'
import ComposedCountdown from './ComposedCountdown'

// A composed block on the web: the tree from its settings, data nodes filled from the store at render time. Every class
// comes from the maps below (theme tokens only), so the output is on brand and responsive whatever the tree says.
// `lcp` is spent by the first picture drawn when the block is the page's first with one; `sizes` is the width the
// current layout gives an image.

type Ctx = { data: ComposedData; gst: boolean; lcp: { on: boolean }; sizes: string }

const claimLcp = (ctx: Ctx) => ctx.lcp.on && !(ctx.lcp.on = false)
const loadAttrs = (priority: boolean) =>
  priority ? ({ loading: 'eager', fetchPriority: 'high', decoding: 'sync' } as const) : ({ loading: 'lazy', decoding: 'async' } as const)
const colSizes = (cols: { web: number; web_mobile: number }) => `(min-width: 768px) ${Math.round(100 / cols.web)}vw, ${Math.round(100 / cols.web_mobile)}vw`

const ICON: Record<string, LucideIcon> = { truck: Truck, shield: Shield, star: Star, heart: Heart, gift: Gift, tag: Tag, sparkles: Sparkles, leaf: Leaf, award: Award, clock: Clock, phone: Phone, 'map-pin': MapPin, check: Check, percent: Percent, package: Package, refresh: RefreshCw }
const BG: Record<string, string> = { default: 'bg-surface text-foreground', muted: 'bg-surface-secondary text-foreground', brand: 'bg-primary-600 text-white', accent: 'bg-accent-500 text-white', dark: 'bg-gray-900 text-white' }
const FG: Record<string, string> = { default: '', muted: 'opacity-75', brand: 'text-primary-600', accent: 'text-accent-600', dark: 'text-gray-900' }
const CHIP: Record<string, string> = { default: 'bg-surface-elevated text-foreground', muted: 'bg-surface-secondary text-foreground-secondary', brand: 'bg-primary-600 text-white', accent: 'bg-accent-500 text-white', dark: 'bg-gray-900 text-white' }
const PAD: Record<string, string> = { none: 'py-0', xs: 'py-2', sm: 'py-4', md: 'py-8', lg: 'py-12 md:py-16', xl: 'py-16 md:py-24' }
const GAP: Record<string, string> = { none: 'gap-0', xs: 'gap-1', sm: 'gap-2', md: 'gap-4', lg: 'gap-8', xl: 'gap-12' }
const SPACE: Record<string, string> = { none: 'h-0', xs: 'h-2', sm: 'h-4', md: 'h-8', lg: 'h-12', xl: 'h-20' }
const ALIGN: Record<string, string> = { left: 'text-left items-start', center: 'text-center items-center', right: 'text-right items-end' }
const JUSTIFY: Record<string, string> = { left: 'justify-start', center: 'justify-center', right: 'justify-end' }
const WIDTH: Record<string, string> = { narrow: 'max-w-3xl', normal: 'max-w-7xl', full: 'max-w-none' }
const COLS_M: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' }
const COLS_D: Record<number, string> = { 1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4', 5: 'md:grid-cols-5', 6: 'md:grid-cols-6' }
const ITEM_W: Record<number, string> = { 1: 'w-[85%]', 2: 'w-[45%]', 3: 'w-[30%]' }
const ITEM_W_D: Record<number, string> = { 1: 'md:w-full', 2: 'md:w-[48%]', 3: 'md:w-[31%]', 4: 'md:w-[23%]', 5: 'md:w-[18.5%]', 6: 'md:w-[15.5%]' }
const ASPECT_M: Record<string, string> = { auto: '', '1:1': 'aspect-square', '4:5': 'aspect-[4/5]', '3:4': 'aspect-[3/4]', '4:3': 'aspect-[4/3]', '16:9': 'aspect-video', '21:9': 'aspect-[21/9]', '3:1': 'aspect-[3/1]' }
const ASPECT_D: Record<string, string> = { auto: '', '1:1': 'md:aspect-square', '4:5': 'md:aspect-[4/5]', '3:4': 'md:aspect-[3/4]', '4:3': 'md:aspect-[4/3]', '16:9': 'md:aspect-video', '21:9': 'md:aspect-[21/9]', '3:1': 'md:aspect-[3/1]' }
const RADIUS: Record<string, string> = { none: 'rounded-none', sm: 'rounded', md: 'rounded-lg', lg: 'rounded-2xl', full: 'rounded-full' }
const RATIO: Record<string, string> = { '1:1': 'md:grid-cols-2', '1:2': 'md:grid-cols-[1fr_2fr]', '2:1': 'md:grid-cols-[2fr_1fr]', '1:3': 'md:grid-cols-[1fr_3fr]', '3:1': 'md:grid-cols-[3fr_1fr]' }
const H_SIZE: Record<number, string> = { 1: 'font-display text-4xl md:text-5xl', 2: 'font-display text-2xl md:text-3xl', 3: 'text-lg md:text-xl font-semibold' }
const T_SIZE: Record<string, string> = { sm: 'text-base', md: 'text-base', lg: 'text-lg' }
const SPEED: Record<string, string> = { slow: '40s', normal: '25s', fast: '14s' }

const aspectClass = (a?: { web?: string; web_mobile?: string }) => (a ? `${ASPECT_M[a.web_mobile ?? a.web ?? 'auto'] ?? ''} ${ASPECT_D[a.web ?? 'auto'] ?? ''}` : '')
const aspectNumber = (a?: string) => {
  const m = a?.match(/^(\d+):(\d+)$/)
  return m ? Number(m[1]) / Number(m[2]) : null
}

/** Items laid out as a responsive grid or a swipeable rail. */
function Items({ layout, cols, label, children }: { layout: 'grid' | 'carousel'; cols: { web: number; web_mobile: number }; label: string; children: ReactNode[] }) {
  if (layout === 'carousel')
    return (
      <SectionCarousel ariaLabel={label} itemClassName={`${ITEM_W[cols.web_mobile] ?? 'w-[45%]'} ${ITEM_W_D[cols.web] ?? 'md:w-[23%]'}`}>
        {children}
      </SectionCarousel>
    )
  return <div className={`grid ${GAP.md} ${COLS_M[cols.web_mobile] ?? 'grid-cols-2'} ${COLS_D[cols.web] ?? 'md:grid-cols-4'}`}>{children}</div>
}

function Products({ n, path, ctx }: { n: NodeOf<'products'>; path: string; ctx: Ctx }) {
  const rows = (ctx.data[path] as any[]) ?? []
  if (!rows.length) return null
  return (
    <Items layout={n.layout} cols={n.cols} label="Products">
      {rows.map(p => (
        <ProductCard key={p.id} {...productCardProps(p, ctx.gst)} imageAspect={aspectNumber(n.aspect?.web)} />
      ))}
    </Items>
  )
}

function Categories({ n, path, ctx }: { n: NodeOf<'categories'>; path: string; ctx: Ctx }) {
  const rows = (ctx.data[path] as CategoryTile[]) ?? []
  if (!rows.length) return null
  return (
    <Items layout={n.layout} cols={n.cols} label="Categories">
      {rows.map(c => (
        <Link key={c.id} href={`/categories/${c.slug}`} className="group block">
          <div className={`relative overflow-hidden rounded-lg bg-surface-secondary ${aspectClass(n.aspect)}`}>
            {c.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img {...responsiveImg(c.image_url, colSizes(n.cols))} {...loadAttrs(claimLcp(ctx))} alt={c.name} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
            )}
          </div>
          <p className="mt-2 text-sm font-semibold">{c.name}</p>
        </Link>
      ))}
    </Items>
  )
}

function Brands({ n, path, ctx }: { n: NodeOf<'brands'>; path: string; ctx: Ctx }) {
  const rows = (ctx.data[path] as BrandTile[]) ?? []
  if (!rows.length) return null
  return (
    <Items layout={n.layout} cols={{ web: 6, web_mobile: 3 }} label="Brands">
      {rows.map(b => (
        <Link key={b.id} href={`/brands/${b.slug}`} className="flex h-20 items-center justify-center rounded-lg border border-border-default bg-surface px-3">
          {b.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img {...responsiveImg(b.logo_url, '160px')} loading="lazy" decoding="async" alt={b.name} className="max-h-12 max-w-full object-contain" />
          ) : (
            <span className="text-sm font-semibold text-foreground">{b.name}</span>
          )}
        </Link>
      ))}
    </Items>
  )
}

function Reviews({ n, path, ctx }: { n: NodeOf<'review'>; path: string; ctx: Ctx }) {
  const rows = (ctx.data[path] as ReviewQuote[]) ?? []
  if (!rows.length) return null
  return (
    <Items layout={n.layout} cols={{ web: Math.min(3, rows.length), web_mobile: 1 }} label="Reviews">
      {rows.map(r => (
        <figure key={r.id} className="h-full rounded-2xl border border-border-default bg-surface p-5 text-foreground">
          <div className="flex gap-0.5 text-accent-500" aria-label={`${r.rating} out of 5`}>
            {Array.from({ length: 5 }, (_, i) => (
              <Star key={i} className={`h-4 w-4 ${i < r.rating ? 'fill-current' : 'opacity-30'}`} />
            ))}
          </div>
          <blockquote className="mt-3 text-base text-foreground-secondary">“{r.comment.length > 280 ? `${r.comment.slice(0, 277)}…` : r.comment}”</blockquote>
          <figcaption className="mt-3 text-xs text-foreground-muted">
            {r.author} on{' '}
            <Link href={`/products/${r.productSlug}`} className="underline">
              {r.productName}
            </Link>
          </figcaption>
        </figure>
      ))}
    </Items>
  )
}

function Offers({ n, path, ctx }: { n: NodeOf<'offers'>; path: string; ctx: Ctx }) {
  const rows = (ctx.data[path] as ProductOffer[]) ?? []
  if (!rows.length) return null
  const cols = { web: Math.min(3, rows.length), web_mobile: 1 }
  return (
    <Items layout={n.layout} cols={cols} label="Offers">
      {rows.map(o => {
        const pic = o.image_url_card ?? o.image_url ?? ''
        return (
        <Link key={o.id} href={offerHref(o.slug)} className="group relative block overflow-hidden rounded-2xl bg-surface-secondary">
          <div className="relative aspect-[4/5] md:aspect-[4/3]">
            {pic && (
              // eslint-disable-next-line @next/next/no-img-element
              <img {...responsiveImg(pic, colSizes(cols))} {...loadAttrs(claimLcp(ctx))} alt={o.title} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-4 text-white">
              {o.badge_text && <span className="mb-2 inline-block rounded-full bg-accent-500 px-2 py-0.5 text-xs font-semibold">{o.badge_text}</span>}
              <p className="font-display text-xl">{o.title}</p>
              {o.subtitle && <p className="text-sm opacity-90">{o.subtitle}</p>}
            </div>
          </div>
        </Link>
        )
      })}
    </Items>
  )
}

function render(n: ComposedNode, path: string, ctx: Ctx): ReactNode {
  const kids = (sizes = ctx.sizes) => n.children?.map((c, i) => <Node key={i} n={c} path={`${path}.${i}`} ctx={sizes === ctx.sizes ? ctx : { ...ctx, sizes }} />)
  switch (n.kind) {
    case 'section': {
      const inner = (
        <section className={`${BG[n.tone]} ${PAD[n.padding]}`}>
          <div className={`mx-auto px-4 ${WIDTH[n.width]} flex flex-col gap-6`}>{kids()}</div>
        </section>
      )
      return n.fx === 'fade' ? <Reveal>{inner}</Reveal> : inner
    }
    case 'grid':
      return <div className={`grid ${GAP[n.gap]} ${COLS_M[n.cols.web_mobile] ?? 'grid-cols-1'} ${COLS_D[n.cols.web] ?? 'md:grid-cols-3'}`}>{kids(colSizes(n.cols))}</div>
    case 'stack':
      return <div className={`flex flex-col ${GAP[n.gap]} ${ALIGN[n.align]}`}>{kids()}</div>
    case 'columns':
      return <div className={`grid grid-cols-1 ${RATIO[n.ratio]} ${GAP[n.gap]} ${n.valign === 'center' ? 'md:items-center' : 'md:items-start'}`}>{kids('(min-width: 768px) 50vw, 100vw')}</div>
    case 'carousel':
      return (
        <SectionCarousel ariaLabel="Gallery" itemClassName="w-[85%] md:w-[31%]">
          {kids('(min-width: 768px) 31vw, 85vw') ?? []}
        </SectionCarousel>
      )
    case 'heading': {
      const Tag = (['h1', 'h2', 'h3'] as const)[n.level - 1]
      return <Tag className={`${H_SIZE[n.level]} ${FG[n.tone]} ${ALIGN[n.align]}`}>{n.text}</Tag>
    }
    case 'text':
      return (
        <div className={`${T_SIZE[n.size]} ${FG[n.tone]} ${ALIGN[n.align]} space-y-3 whitespace-pre-line`}>
          {n.text.split(/\n{2,}/).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      )
    case 'image': {
      const img = (
        <div className={`group relative overflow-hidden bg-surface-secondary ${RADIUS[n.radius]} ${aspectClass(n.aspect)}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img {...responsiveImg(n.src, ctx.sizes)} {...loadAttrs(claimLcp(ctx))} alt={n.alt} className={`${aspectClass(n.aspect).trim() ? 'absolute inset-0 h-full' : 'block'} w-full object-cover transition-opacity duration-500 ${n.hoverSrc ? 'group-hover:opacity-0' : ''}`} />
          {n.hoverSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img {...responsiveImg(n.hoverSrc, ctx.sizes)} alt="" aria-hidden loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
          )}
        </div>
      )
      return n.href ? <Link href={n.href}>{img}</Link> : img
    }
    case 'button': {
      const cls =
        n.variant === 'solid'
          ? 'bg-accent-500 text-white hover:bg-accent-600'
          : n.variant === 'outline'
            ? 'border border-current hover:bg-black/5'
            : 'underline underline-offset-4'
      return (
        <Link href={n.href} className={`inline-flex min-h-12 items-center justify-center self-start rounded-lg px-5 text-sm font-semibold transition-colors ${cls}`}>
          {n.label}
        </Link>
      )
    }
    case 'badge':
      return <span className={`inline-block self-start rounded-full px-3 py-1 text-xs font-semibold ${CHIP[n.tone]}`}>{n.text}</span>
    case 'icon': {
      const Icon = ICON[n.name] ?? Sparkles
      return <Icon aria-hidden className={`${n.size === 'sm' ? 'h-5 w-5' : n.size === 'lg' ? 'h-10 w-10' : 'h-7 w-7'} ${FG[n.tone]}`} />
    }
    case 'spacer':
      return <div aria-hidden className={SPACE[n.size]} />
    case 'divider':
      return <hr className="border-border-default" />
    case 'products':
      return <Products n={n} path={path} ctx={ctx} />
    case 'categories':
      return <Categories n={n} path={path} ctx={ctx} />
    case 'brands':
      return <Brands n={n} path={path} ctx={ctx} />
    case 'review':
      return <Reviews n={n} path={path} ctx={ctx} />
    case 'offers':
      return <Offers n={n} path={path} ctx={ctx} />
    case 'countdown':
      return Date.parse(n.endsAt) > Date.now() ? (
        <div className={`flex ${JUSTIFY[n.align]}`}>
          <ComposedCountdown endsAt={n.endsAt} label={n.label} />
        </div>
      ) : null
    case 'marquee':
      return (
        <div className={`composed-marquee overflow-hidden rounded-lg py-3 ${CHIP[n.tone]}`}>
          <div className="composed-marquee-track flex w-max gap-10 whitespace-nowrap text-sm font-semibold" style={{ animationDuration: SPEED[n.speed] }}>
            {[...n.items, ...n.items].map((t, i) => (
              <span key={i} aria-hidden={i >= n.items.length}>
                {t}
              </span>
            ))}
          </div>
        </div>
      )
    default:
      return null
  }
}

function Node({ n, path, ctx }: { n: ComposedNode; path: string; ctx: Ctx }) {
  return <>{render(n, path, ctx)}</>
}

const MARQUEE_CSS = `@keyframes composed-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}.composed-marquee-track{animation:composed-marquee linear infinite}.composed-marquee:hover .composed-marquee-track{animation-play-state:paused}@media (prefers-reduced-motion:reduce){.composed-marquee-track{animation:none}}`

/**
 * `data`: already loaded with the page's other sections (the home page); otherwise loaded here. `priority`: the block
 * is the page's first with a picture, so its first picture is the LCP image.
 */
export default async function ComposedBlock({ props, data: preloaded, priority = false }: { props: Record<string, unknown>; data?: ComposedData; priority?: boolean }) {
  const { tree } = cleanTree(props.tree)
  if (!tree) return null
  const { gstEnabled } = await getFeatureFlags()
  const data = preloaded ?? (await loadComposedData(tree, gstEnabled))
  let marquee = false
  const ctx: Ctx = { data, gst: gstEnabled, lcp: { on: priority }, sizes: '100vw' }
  const scan = (n: ComposedNode) => {
    if (n.kind === 'marquee') marquee = true
    n.children?.forEach(scan)
  }
  scan(tree)
  return (
    <>
      {marquee && <style>{MARQUEE_CSS}</style>}
      <Node n={tree} path="0" ctx={ctx} />
    </>
  )
}
