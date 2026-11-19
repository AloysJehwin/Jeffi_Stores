import type { ReactNode } from 'react'
import { BadgeCheck, Heart, RotateCcw, Share2, ShieldCheck, Truck } from 'lucide-react'
import ProductSpecifications from '@/components/visitor/pdp/ProductSpecifications'
import ProductFeatures from '@/components/visitor/pdp/ProductFeatures'
import ProductInfoSections from '@/components/visitor/pdp/ProductInfoSections'
import ProductDescriptionCard from '@/components/visitor/pdp/ProductDescriptionCard'
import ProductReviews from '@/components/visitor/ProductReviews'
import { PDP_REVIEWS_ID } from '@/components/visitor/pdp/pdp'
import { renderProductItem } from '@/components/visitor/listing/listing-items'
import { ProductItem } from '@/components/visitor/site/code/common/SiteCard'
import SectionCarousel from '@/components/visitor/SectionCarousel'
import { siteCard } from '@/lib/site/card'
import type { RenderCtx } from '@/lib/site/code/registry'
import type { ProductDetailView, ProductView, SiteData } from '@/lib/site/data/types'
import { productParts } from './context'
import { detailView, rowViews } from './views'

// The product page's server-rendered parts. On a product page they read the page's own product (ProductPageParts);
// elsewhere (the onboarding preview) they show the catalogue's first product so the layout can be judged.

const views = new WeakMap<object, ProductDetailView>()

/** The current product as the `<Product>` binding. */
export async function currentProduct(ctx: RenderCtx): Promise<ProductDetailView | null> {
  const parts = productParts()
  if (parts) {
    let v = views.get(parts)
    if (!v) views.set(parts, (v = detailView(parts.product, parts.gstEnabled, parts.reviewSummary)))
    return v
  }
  const [first] = await ctx.data.products({ sort: 'featured', limit: 1 })
  return first ? ctx.data.product(first.slug) : null
}

const cx = (base: string, extra: unknown) => (typeof extra === 'string' && extra.trim() ? `${base} ${extra}` : base)
const own = (extra: unknown, fallback: string) => (typeof extra === 'string' && extra.trim() ? extra : fallback)

export async function renderProductBinding(ctx: RenderCtx, className: unknown): Promise<ReactNode> {
  const p = await currentProduct(ctx)
  if (!p) return null
  const body = ctx.renderItem ? ctx.renderItem(p) : ctx.children
  return typeof className === 'string' && className ? <div className={className}>{body}</div> : body
}

export async function renderTitle(ctx: RenderCtx, props: Record<string, unknown>): Promise<ReactNode> {
  const p = await currentProduct(ctx)
  if (!p) return null
  const Tag = props.as === 'h2' ? 'h2' : 'h1'
  return <Tag className={own(props.className, 'text-2xl sm:text-3xl font-bold text-foreground')}>{p.name}</Tag>
}

export async function renderDescription(ctx: RenderCtx, props: Record<string, unknown>): Promise<ReactNode> {
  const parts = productParts()
  if (parts && props.card !== false) {
    if (!parts.product.description) return null
    return typeof props.className === 'string' && props.className ? (
      <div className={props.className}>
        <ProductDescriptionCard product={parts.product} />
      </div>
    ) : (
      <ProductDescriptionCard product={parts.product} />
    )
  }
  const p = await currentProduct(ctx)
  if (!p?.description) return null
  return <p className={own(props.className, 'text-foreground-secondary leading-relaxed whitespace-pre-line')}>{p.description}</p>
}

export async function renderSpecs(ctx: RenderCtx, props: Record<string, unknown>): Promise<ReactNode> {
  const parts = productParts()
  if (parts) {
    const row = parts.product
    return (
      <div className={typeof props.className === 'string' ? props.className : undefined}>
        <ProductSpecifications product={row} />
        {props.features !== false && <ProductFeatures product={row} />}
        {props.info !== false && <ProductInfoSections product={row} faqs={row.faqs} />}
      </div>
    )
  }
  const p = await currentProduct(ctx)
  if (!p?.attributes.length) return null
  return (
    <dl className={cx('grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-4', props.className)}>
      {p.attributes.map(a => (
        <div key={a.name}>
          <dt className="text-xs text-foreground-muted mb-0.5">{a.name}</dt>
          <dd className="text-sm font-semibold text-foreground break-words">{a.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export async function renderReviews(ctx: RenderCtx, props: Record<string, unknown>): Promise<ReactNode> {
  const parts = productParts()
  if (parts) {
    return (
      <div id={PDP_REVIEWS_ID} className={cx('scroll-mt-16 lg:scroll-mt-20', props.className)}>
        <ProductReviews productId={parts.product.id} productName={parts.product.name} />
      </div>
    )
  }
  const p = await currentProduct(ctx)
  if (!p) return null
  const reviews = await ctx.data.reviews({ productSlug: p.slug, minRating: 1, limit: 6 })
  if (!reviews.length) return null
  return (
    <div id={PDP_REVIEWS_ID} className={cx('space-y-4', props.className)}>
      {reviews.map(r => (
        <div key={r.id} className="rounded-lg border border-border-default p-4">
          <p className="text-yellow-500" aria-label={`${r.rating} out of 5`}>{r.stars}</p>
          {r.title && <p className="font-semibold text-foreground">{r.title}</p>}
          <p className="text-sm text-foreground-secondary">{r.comment}</p>
          <p className="mt-1 text-xs text-foreground-muted">{r.author}</p>
        </div>
      ))}
    </div>
  )
}

const RELATED_GRID = 'grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4'

/** How many related products the section would show (none hides it). */
export async function relatedCount(data: SiteData, props: Record<string, unknown>): Promise<number> {
  const limit = Math.min(8, Math.max(1, Number(props.limit) || 4))
  const parts = productParts()
  if (parts) return Math.min(limit, parts.related.length)
  const p = await currentProduct({ data } as RenderCtx)
  const list = await data.products({ sort: 'featured', limit: limit + 1, ...(p?.categorySlug ? { category: p.categorySlug } : {}) })
  return list.filter(v => v.id !== p?.id).length
}

export async function renderRelated(ctx: RenderCtx, props: Record<string, unknown>): Promise<ReactNode> {
  const limit = Math.min(8, Math.max(1, Number(props.limit) || 4))
  // The list: its grid, or one product a slide.
  const list = (kids: ReactNode[]) =>
    props.layout === 'carousel' ? (
      <div className={typeof props.className === 'string' ? props.className : undefined}>
        <SectionCarousel ariaLabel="Related products" itemClassName={own(props.itemClassName, 'w-[45%] md:w-[23%]')}>
          {kids}
        </SectionCarousel>
      </div>
    ) : (
      <div className={own(props.className, RELATED_GRID)}>{kids}</div>
    )
  const parts = productParts()
  const card = ctx.renderItem ? null : await siteCard(ctx.data)
  let items: ProductView[]
  if (parts) {
    const rows = parts.related.slice(0, limit)
    if (!rows.length) return null
    if (!ctx.renderItem && !card) {
      return list(rows.map(row => <div key={row.id}>{renderProductItem(row, parts.gstEnabled, true)}</div>))
    }
    items = await rowViews(rows, parts.gstEnabled)
  } else {
    const p = await currentProduct(ctx)
    items = (await ctx.data.products({ sort: 'featured', limit: limit + 1, ...(p?.categorySlug ? { category: p.categorySlug } : {}) }))
      .filter(v => v.id !== p?.id)
      .slice(0, limit)
    if (!items.length) return null
  }
  const render = ctx.renderItem
  return list(items.map((v, i) => (render ? render(v, i) : <ProductItem key={v.id} product={v} card={card} data={ctx.data} deferred />)))
}

// Off a product page the interactive parts have no product to act on; the preview shows what they look like.

const PREVIEW_BTN = 'w-full px-6 py-4 rounded-lg font-semibold flex items-center justify-center gap-2 text-white'

export async function renderPreview(name: string, ctx: RenderCtx, props: Record<string, unknown>): Promise<ReactNode> {
  const p = await currentProduct(ctx)
  if (!p) return null
  const className = typeof props.className === 'string' ? props.className : undefined
  switch (name) {
    case 'ProductGallery': {
      const images = (p.images.length ? p.images : p.image ? [p.image] : []).slice(0, props.layout === 'carousel' || !props.layout ? 1 : 4)
      if (!images.length) return null
      return (
        <div className={cx(props.layout === 'grid' ? 'grid grid-cols-2 gap-3' : 'flex flex-col gap-3', className)}>
          {images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt={`${p.name} - Image ${i + 1}`} className="w-full rounded-xl border border-border-default bg-surface-elevated object-contain aspect-square" />
          ))}
        </div>
      )
    }
    case 'ProductPrice':
      return (
        <div className={cx('flex items-baseline gap-2 flex-wrap', className)}>
          <span className="text-4xl font-bold text-primary-600 dark:text-primary-400">{p.price.formatted}</span>
          {p.mrp && <span className="text-xl text-foreground-muted line-through">{p.mrp.formatted}</span>}
          {p.discountPct > 0 && <span className="text-sm font-semibold text-accent-600">{p.discountPct}% off</span>}
        </div>
      )
    case 'ProductRating':
      return p.rating ? (
        <p className={cx('text-sm text-foreground-secondary', className)}>
          <span className="text-yellow-500">{'★'.repeat(Math.round(p.rating))}</span> {p.rating.toFixed(1)} · {p.reviewCount} reviews
        </p>
      ) : null
    case 'AddToCart':
      return (
        <span role="presentation" className={cx(`${PREVIEW_BTN} bg-primary-600`, className)}>
          {typeof props.label === 'string' && props.label ? props.label : 'Add to Cart'}
        </span>
      )
    case 'BuyNow':
      return (
        <span role="presentation" className={cx(`${PREVIEW_BTN} bg-accent-500`, className)}>
          {typeof props.label === 'string' && props.label ? props.label : 'Buy Now'}
        </span>
      )
    case 'VariantPicker':
      return <VariantPreview style={props.style === 'swatches' || props.style === 'dropdown' ? props.style : 'buttons'} className={className} />
    case 'QuantityPicker':
      return (
        <div role="presentation" className={cx('space-y-2', className)}>
          <p className="text-sm font-medium text-foreground">Quantity</p>
          <div className="inline-flex items-center rounded-lg border border-border-secondary text-foreground">
            <span className="flex h-11 w-11 items-center justify-center text-lg text-foreground-muted">−</span>
            <span className="flex h-11 w-12 items-center justify-center border-x border-border-secondary font-semibold">1</span>
            <span className="flex h-11 w-11 items-center justify-center text-lg">+</span>
          </div>
          {props.stock !== false && <p className={`text-sm font-medium ${p.inStock ? 'text-green-600' : 'text-red-600'}`}>{p.inStock ? 'In stock' : 'Out of stock'}</p>}
        </div>
      )
    case 'WishlistButton':
      return (
        <div role="presentation" className={cx('flex items-center gap-2', className)}>
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border-default bg-surface text-foreground-muted">
            <Heart aria-hidden className="h-5 w-5" />
          </span>
          {props.share === true && (
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border-default bg-surface text-foreground-muted">
              <Share2 aria-hidden className="h-5 w-5" />
            </span>
          )}
        </div>
      )
    case 'DeliveryCheck':
      return (
        <div role="presentation" className={cx('space-y-3', className)}>
          {props.policies !== false && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {POLICY_TILES.map(({ Icon, label }) => (
                <span key={label} className="flex flex-col items-center gap-1 rounded-lg border border-border-default bg-surface-elevated px-2 py-3 text-center text-xs text-foreground-secondary">
                  <Icon aria-hidden className="h-5 w-5 text-accent-600" />
                  {label}
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <span className="flex h-11 flex-1 items-center rounded-lg border border-border-secondary bg-surface px-3 text-sm text-foreground-muted">Enter pincode</span>
            <span className="flex h-11 items-center rounded-lg bg-accent-500 px-4 text-sm font-semibold text-white">Check</span>
          </div>
        </div>
      )
    default:
      return null
  }
}

const POLICY_TILES = [
  { Icon: Truck, label: 'Delivery' },
  { Icon: RotateCcw, label: 'Returns' },
  { Icon: BadgeCheck, label: 'Genuine products' },
  { Icon: ShieldCheck, label: 'Secure payment' },
]

/** VariantPicker off a product page: a size or colour choice, the first one picked. */
function VariantPreview({ style, className }: { style: 'buttons' | 'swatches' | 'dropdown'; className?: string }) {
  if (style === 'dropdown')
    return (
      <div role="presentation" className={cx('space-y-2', className)}>
        <p className="text-sm font-medium text-foreground">Size</p>
        <span className="flex h-11 w-full max-w-xs items-center justify-between rounded-lg border border-border-secondary bg-surface px-3 text-sm text-foreground">
          M <span className="text-foreground-muted">▾</span>
        </span>
      </div>
    )
  if (style === 'swatches')
    return (
      <div role="presentation" className={cx('space-y-2', className)}>
        <p className="text-sm font-medium text-foreground">Colour</p>
        <div className="flex gap-2">
          {['bg-primary-500', 'bg-accent-500', 'bg-secondary-700', 'bg-surface-secondary'].map((c, i) => (
            <span key={c} className={`h-9 w-9 rounded-full border border-border-default ${c} ${i === 0 ? 'ring-2 ring-accent-500 ring-offset-2' : ''}`} />
          ))}
        </div>
      </div>
    )
  return (
    <div role="presentation" className={cx('space-y-2', className)}>
      <p className="text-sm font-medium text-foreground">Size</p>
      <div className="flex flex-wrap gap-2">
        {['S', 'M', 'L', 'XL'].map((s, i) => (
          <span key={s} className={`flex h-11 min-w-[2.75rem] items-center justify-center rounded-lg border px-3 text-sm font-medium ${i === 0 ? 'border-accent-500 bg-accent-50 text-accent-700' : 'border-border-default text-foreground'}`}>
            {s}
          </span>
        ))}
      </div>
    </div>
  )
}
