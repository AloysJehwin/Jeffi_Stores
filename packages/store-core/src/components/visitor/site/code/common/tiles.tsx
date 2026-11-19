import { Children, Fragment, cloneElement, isValidElement, type ReactNode } from 'react'
import Link from 'next/link'
import { ShoppingBag, Star } from 'lucide-react'
import ProductCard from '@/components/visitor/ProductCard'
import SectionCarousel from '@/components/visitor/SectionCarousel'
import { safeHref, safeSrc } from '@/lib/site/code/allow'
import type { BrandView, CategoryView, OfferView, ProductView, ReviewView } from '@/lib/site/data/types'
import { responsiveImg } from '@/lib/shared/image-url'
import { portalHere } from '@/lib/site/portal'
import { CODE_ICONS } from './icons'

// Server renderers behind the engine's common code components (lib/site/code/parts/common.tsx). Every class here is
// literal, so the apps' own Tailwind build (which scans this folder) has it.


/** Testimonials' slides by default: three to a row from md, gaps included (here so the apps' Tailwind sees the class). */
export const TESTIMONIAL_SLIDE = 'w-[85%] md:w-[calc((100%-2.5rem)/3)]'
export const ASPECTS = ['auto', '1:1', '4:5', '3:4', '2:3', '4:3', '3:2', '16:9', '21:9', '3:1'] as const
const ASPECT: Record<string, string> = {
  auto: '', '1:1': 'aspect-square', '4:5': 'aspect-[4/5]', '3:4': 'aspect-[3/4]', '2:3': 'aspect-[2/3]', '4:3': 'aspect-[4/3]', '3:2': 'aspect-[3/2]',
  '16:9': 'aspect-video', '21:9': 'aspect-[21/9]', '3:1': 'aspect-[3/1]',
}
const RATIO: Record<string, number> = { '1:1': 1, '4:5': 0.8, '3:4': 0.75, '2:3': 2 / 3, '4:3': 4 / 3, '3:2': 1.5, '16:9': 16 / 9, '21:9': 21 / 9, '3:1': 3 }
const loadAttrs = (priority: boolean) =>
  priority ? ({ loading: 'eager', fetchPriority: 'high', decoding: 'sync' } as const) : ({ loading: 'lazy', decoding: 'async' } as const)

const initialOf = (label?: string) => {
  const ch = [...(label ?? '').trim()][0] ?? ''
  return /[\p{L}\p{N}]/u.test(ch) ? ch.toLocaleUpperCase('en-IN') : ''
}

/**
 * A picture that isn't there yet, designed rather than missing: the theme's tints with the item's initial (a store
 * mark when it has no name), never a "no image" glyph. Its letter scales with the box (an SVG).
 */
export function ImagePlaceholder({ label, className = '' }: { label?: string; className?: string }) {
  const initial = initialOf(label)
  return (
    <div
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      data-picture-fallback=""
      className={`relative isolate overflow-hidden bg-gradient-to-br from-primary-100 via-surface-secondary to-accent-100 ${className}`}
    >
      <span aria-hidden className="absolute -left-1/4 -top-1/4 h-3/4 w-3/4 rounded-full bg-primary-200/60 blur-3xl" />
      <span aria-hidden className="absolute -bottom-1/4 -right-1/4 h-3/4 w-3/4 rounded-full bg-accent-200/60 blur-3xl" />
      {initial ? (
        <svg aria-hidden viewBox="0 0 100 100" className="absolute inset-0 h-full w-full text-primary-700/20">
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fill="currentColor" className="font-display" fontSize="52" fontWeight="600">
            {initial}
          </text>
        </svg>
      ) : (
        <ShoppingBag aria-hidden strokeWidth={1.25} className="absolute left-1/2 top-1/2 h-1/4 max-h-12 w-1/4 max-w-12 -translate-x-1/2 -translate-y-1/2 text-primary-700/25" />
      )}
    </div>
  )
}

export function CodeImage({
  src,
  hoverSrc,
  alt = '',
  aspect = 'auto',
  fit = 'cover',
  sizes = '(min-width: 768px) 50vw, 100vw',
  priority = false,
  className = '',
}: {
  src?: unknown
  hoverSrc?: unknown
  alt?: string
  aspect?: string
  fit?: 'cover' | 'contain'
  sizes?: string
  priority?: boolean
  className?: string
}) {
  const url = safeSrc(src)
  const hover = safeSrc(hoverSrc)
  const box = ASPECT[aspect] ?? ''
  const objectFit = fit === 'contain' ? 'object-contain' : 'object-cover'
  if (!url) return <ImagePlaceholder label={alt} className={`${box || 'aspect-[4/3]'} ${className}`} />
  if (!box && !hover)
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...responsiveImg(url, sizes)} {...loadAttrs(priority)} alt={alt} className={`${objectFit} ${className}`} />
  return (
    <div className={`group/img relative overflow-hidden bg-surface-secondary ${box} ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img {...responsiveImg(url, sizes)} {...loadAttrs(priority)} alt={alt} className={`${box ? 'absolute inset-0 h-full' : 'block'} w-full ${objectFit} transition-opacity duration-500 ${hover ? 'group-hover/img:opacity-0' : ''}`} />
      {hover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img {...responsiveImg(hover, sizes)} alt="" aria-hidden loading="lazy" decoding="async" className={`absolute inset-0 h-full w-full ${objectFit} opacity-0 transition-opacity duration-500 group-hover/img:opacity-100`} />
      )}
    </div>
  )
}

export function CodeLink({ href, target, className, children }: { href?: unknown; target?: '_blank' | '_self'; className?: string; children?: ReactNode }) {
  const url = safeHref(href)
  if (!url) return <span className={className}>{children}</span>
  if (url.startsWith('/') && target !== '_blank')
    return (
      <Link href={url} className={className}>
        {children}
      </Link>
    )
  return (
    <a href={url} className={className} {...(target === '_blank' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {children}
    </a>
  )
}

const ICON_SIZE: Record<string, string> = { xs: 'h-3.5 w-3.5', sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8', xl: 'h-12 w-12' }
export function CodeIcon({ name, size = 'md', strokeWidth = 1.75, className = '' }: { name: string; size?: string; strokeWidth?: number; className?: string }) {
  const Icon = CODE_ICONS[name]
  if (!Icon) return null
  return <Icon aria-hidden strokeWidth={strokeWidth} className={`${ICON_SIZE[size] ?? ICON_SIZE.md} shrink-0 ${className}`} />
}

/** ProductCard (cart, wishlist, quick add) for a ProductView, with this app's links and prices (business portal or store). */
export function ProductTile({ product, aspect, deferred }: { product: ProductView; aspect?: string; deferred?: boolean }) {
  if (!product || typeof product !== 'object' || typeof product.slug !== 'string') return null
  return (
    <ProductCard
      id={product.id}
      name={product.name}
      slug={product.slug}
      hasVariants={!!product.hasVariants}
      displayPrice={product.price?.value ?? 0}
      mrp={product.mrp?.value ?? null}
      mrpDiscount={product.discountPct ?? 0}
      effectiveStock={product.inStock ? 1 : 0}
      primaryImage={product.image ? { image_url: product.image } : null}
      brandName={product.brand}
      categoryName={product.category}
      categoryId={product.categoryId}
      badge={product.badge}
      isDigital={product.isDigital}
      imageAspect={aspect ? (RATIO[aspect] ?? null) : null}
      deferred={deferred}
      portal={portalHere()}
    />
  )
}

/** A category's picture and name; `fill` covers its cell with the picture (a mosaic's fixed rows), the name over it. */
export function CategoryTile({ c, priority, fill = false, className = '' }: { c: CategoryView; priority: boolean; fill?: boolean; className?: string }) {
  if (fill)
    return (
      <Link href={c.url} className={`group relative block h-full min-h-[8rem] overflow-hidden rounded-[var(--radius-card,0.75rem)] ${className}`}>
        <CodeImage src={c.image} alt={c.name} sizes="(min-width: 1024px) 50vw, 100vw" priority={priority} className="absolute inset-0 h-full w-full transition-transform duration-500 group-hover:scale-105" />
        <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        <span className="absolute inset-x-0 bottom-0 p-4 font-display text-lg font-semibold text-white md:text-xl">{c.name}</span>
      </Link>
    )
  return (
    <Link href={c.url} className={`group block ${className}`}>
      <CodeImage src={c.image} alt={c.name} aspect="1:1" sizes="(min-width: 768px) 25vw, 50vw" priority={priority} className="rounded-[var(--radius-card,0.75rem)]" />
      <p className="mt-2 text-sm font-semibold text-foreground">{c.name}</p>
    </Link>
  )
}

export function BrandTile({ b, className = '' }: { b: BrandView; className?: string }) {
  return (
    <Link href={b.url} className={`flex h-20 items-center justify-center rounded-[var(--radius-card,0.75rem)] border border-border-default bg-surface px-3 ${className}`}>
      {b.logo && safeSrc(b.logo) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img {...responsiveImg(b.logo, '160px')} loading="lazy" decoding="async" alt={b.name} className="max-h-12 max-w-full object-contain" />
      ) : (
        <span className="text-sm font-semibold text-foreground">{b.name}</span>
      )}
    </Link>
  )
}

export function ReviewCard({ r, className = '' }: { r: ReviewView; className?: string }) {
  return (
    <figure className={`h-full rounded-[var(--radius-card,0.75rem)] border border-border-default bg-surface p-5 text-foreground ${className}`}>
      <div className="flex gap-0.5 text-accent-500" aria-label={`${r.rating} out of 5`}>
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} className={`h-4 w-4 ${i < r.rating ? 'fill-current' : 'opacity-30'}`} />
        ))}
      </div>
      <blockquote className="mt-3 text-base text-foreground-secondary">“{r.comment.length > 280 ? `${r.comment.slice(0, 277)}…` : r.comment}”</blockquote>
      <figcaption className="mt-3 text-xs text-foreground-muted">
        {r.author} on{' '}
        <Link href={r.productUrl} className="underline">
          {r.productName}
        </Link>
      </figcaption>
    </figure>
  )
}

/** An offer's picture card; `fill` covers its cell (a mosaic's fixed rows). */
export function OfferCard({ o, priority, fill = false, className = '' }: { o: OfferView; priority: boolean; fill?: boolean; className?: string }) {
  return (
    <Link href={o.url} className={`group relative block overflow-hidden rounded-[var(--radius-card,0.75rem)] bg-surface-secondary ${fill ? 'h-full min-h-[8rem]' : ''} ${className}`}>
      <CodeImage src={o.image} alt={o.title} aspect={fill ? 'auto' : '4:5'} sizes="(min-width: 768px) 33vw, 100vw" priority={priority} className={fill ? 'absolute inset-0 h-full w-full' : ''} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-4 text-white">
        {o.badge && <span className="mb-2 inline-block rounded-full bg-accent-500 px-2 py-0.5 text-xs font-semibold">{o.badge}</span>}
        <p className="font-display text-xl">{o.title}</p>
        {o.subtitle && <p className="text-sm opacity-90">{o.subtitle}</p>}
      </div>
    </Link>
  )
}

// The mosaic: two columns on phones (the first item 2×2, an even count's last item full width), twelve from lg (the
// first two rows tall, then rows of four whose last row stretches), so any number of items fills its rectangle. Its gap
// and row height are arbitrary properties a section never writes, so a section's gap-* or auto-rows-* always wins (a
// section's own rule for a class written here would otherwise fight it by Tailwind's order).
const MOSAIC =
  'grid grid-cols-2 [gap:0.75rem] [grid-auto-rows:11rem] sm:[gap:1rem] sm:[grid-auto-rows:13rem] lg:grid-cols-12 lg:[gap:1.25rem] lg:[grid-auto-rows:15rem]'
const LG_COLS: Record<number, string> = { 3: 'lg:col-span-3', 4: 'lg:col-span-4', 5: 'lg:col-span-5', 6: 'lg:col-span-6', 7: 'lg:col-span-7', 12: 'lg:col-span-12' }

/** Item i of n in the mosaic from lg: [columns of 12, rows]. */
export function mosaicSpan(i: number, n: number): [number, number] {
  if (n === 1) return [12, 2]
  if (n === 2) return [i === 0 ? 7 : 5, 2]
  if (n === 3) return i === 0 ? [7, 2] : [5, 1]
  if (i === 0) return [6, 2]
  if (n === 4) return [i === 1 ? 6 : 3, 1]
  if (i < 5) return [3, 1]
  const rest = n - 5
  const tail = rest % 4
  if (i - 5 < rest - tail) return [3, 1]
  return [tail === 1 ? 12 : tail === 2 ? 6 : 4, 1]
}

export function mosaicItemClass(i: number, n: number): string {
  const phone = i === 0 ? 'col-span-2 row-span-2' : i === n - 1 && n % 2 === 0 ? 'col-span-2' : ''
  const [cols, rows] = mosaicSpan(i, n)
  return `${phone} ${LG_COLS[cols]} ${rows === 2 ? 'lg:row-span-2' : 'lg:row-span-1'}`
}

// Parts that put a className on their root element.
const CLASSED = new Set<unknown>([CodeLink, Link, CategoryTile, BrandTile, OfferCard, ReviewCard])

/**
 * An item with classes added to its own root element, so the grid places that element and the variants written on it
 * (first:, group-first:) still read its real position. An item without one plain root (several elements, a part still
 * loading) is wrapped instead.
 */
function withClass(node: ReactNode, cls: string, key: number): ReactNode {
  let el: ReactNode = node
  while (isValidElement<{ children?: ReactNode }>(el) && el.type === Fragment) {
    const kids = Children.toArray(el.props.children)
    if (kids.length !== 1) break
    el = kids[0]
  }
  if (isValidElement<{ className?: string }>(el) && (typeof el.type === 'string' || CLASSED.has(el.type)))
    return cloneElement(el, { key, className: `${el.props.className ?? ''} ${cls}`.trim() })
  return (
    <div key={key} className={cls}>
      {node}
    </div>
  )
}

/**
 * A data component's items: a grid (the AI's className, or a default), a mosaic that fits any count, a swipeable rail,
 * or a plain stack. itemClassName goes on each item (grid spans, slide widths), whatever drew it: a default tile or what
 * a render function returned.
 */
export function ItemsLayout({
  layout,
  className,
  itemClassName,
  label,
  fallbackGrid,
  children,
}: {
  layout: 'grid' | 'carousel' | 'list' | 'mosaic'
  className?: string
  itemClassName?: string
  label: string
  fallbackGrid: string
  children: ReactNode[]
}) {
  if (layout === 'carousel')
    return (
      <div className={className}>
        <SectionCarousel ariaLabel={label} itemClassName={itemClassName || 'w-[45%] md:w-[23%]'}>
          {children}
        </SectionCarousel>
      </div>
    )
  if (layout === 'mosaic') {
    const kids = children.filter(c => c != null && c !== false)
    return <div className={`${MOSAIC} ${className ?? ''}`}>{kids.map((c, i) => withClass(c, `${mosaicItemClass(i, kids.length)} ${itemClassName ?? ''}`, i))}</div>
  }
  const items = itemClassName ? children.map((c, i) => withClass(c, itemClassName, i)) : children
  if (layout === 'list') return <div className={className || 'flex flex-col gap-4'}>{items}</div>
  return <div className={className || fallbackGrid}>{items}</div>
}
