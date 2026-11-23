import type { ReactElement, ReactNode } from 'react'
import { z } from 'zod'
import { defineCodeComponent, type RenderCtx } from '../registry'
import { MAX_EACH, safeSrc } from '../allow'
import { ProductQuery } from '../../composed'
import type { CategoryView, OfferView, ProductView, SiteData } from '../../data/types'
import { siteCard } from '../../card'
import { ASPECTS, BrandTile, CategoryTile, CodeIcon, CodeImage, CodeLink, ItemsLayout, OfferCard, ReviewCard } from '@/components/visitor/site/code/common/tiles'
import { ProductItem } from '@/components/visitor/site/code/common/SiteCard'
import { CODE_ICON_NAMES } from '@/components/visitor/site/code/common/icons'
import SectionCarousel from '@/components/visitor/SectionCarousel'
import Tabs, { TabPanel } from '@/components/visitor/site/code/islands/Tabs'
import Accordion, { AccordionItem } from '@/components/visitor/site/code/islands/Accordion'
import Marquee from '@/components/visitor/site/code/islands/Marquee'
import Reveal from '@/components/visitor/site/code/islands/Reveal'
import Countdown from '@/components/visitor/site/code/islands/Countdown'

// The engine's common components: store data with render functions, the product card, images, links, icons, and the
// interactive pieces (carousel, tabs, accordion, marquee, reveal, countdown). Any page may use them.

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined)
const slug = z.string().trim().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/i)
export const layoutProps = {
  layout: z
    .enum(['grid', 'carousel', 'list', 'mosaic'])
    .default('grid')
    .describe('grid uses className as the grid; mosaic is a picture mosaic (the first item large) that fits any number of items, className adding only gap or auto-rows-[…]; carousel swipes'),
  itemClassName: z.string().max(200).optional().describe('classes on each item: grid spans ("lg:col-span-2"), carousel widths ("w-[70%] md:w-[30%]")'),
}

export const PRODUCT_FIELDS: Record<string, string> = {
  id: 'product id',
  slug: 'url slug',
  name: 'product name',
  url: 'link to the product page',
  image: 'image URL or null',
  hoverImage: 'second image URL or null',
  price: '{ formatted: "₹1,299", value: 1299 }',
  mrp: '{ formatted, value } when on sale, else null',
  discountPct: 'percent off MRP, 0 when not on sale',
  badge: 'badge text or null',
  brand: 'brand name or null',
  category: 'category name or null',
  inStock: 'true when in stock',
  rating: 'average rating or null',
  reviewCount: 'number of reviews',
}

/** Items through the render function, or the default tile. */
function items<T>(list: T[], ctx: RenderCtx, tile: (item: T, i: number) => ReactNode) {
  return list.slice(0, MAX_EACH).map((it, i) => (ctx.renderItem ? ctx.renderItem(it, i) : tile(it, i)))
}

const ProductsProps = z.object({
  query: ProductQuery.partial().optional().describe('category/brand slugs, search, slugs, onSale, inStock, featured, sort, limit (≤24)'),
  category: slug.optional(),
  brand: slug.optional(),
  sort: ProductQuery.shape.sort.optional(),
  limit: z.number().int().min(1).max(24).optional(),
  onSale: z.boolean().optional(),
  featured: z.boolean().optional(),
  aspect: z.enum(ASPECTS).optional().describe('image shape of the default product cards'),
  ...layoutProps,
})
async function productList(p: z.infer<typeof ProductsProps>, data: SiteData): Promise<ProductView[]> {
  const flat = Object.fromEntries(Object.entries({ category: p.category, brand: p.brand, sort: p.sort, limit: p.limit, onSale: p.onSale, featured: p.featured }).filter(([, v]) => v !== undefined))
  const q = ProductQuery.safeParse({ ...flat, ...(p.query ?? {}) })
  return q.success ? data.products(q.data) : []
}

defineCodeComponent({
  name: 'Products',
  pages: 'any',
  props: ProductsProps,
  binding: PRODUCT_FIELDS,
  describe:
    "Store products, each drawn as the site's product card (made for this site, with add to cart). className lays them out. A render function replaces the card: only for a special layout (a spotlight, a numbered list).",
  count: async (props, data) => (await productList(props as z.infer<typeof ProductsProps>, data)).length,
  async render(props, ctx) {
    const p = props as z.infer<typeof ProductsProps>
    const list = await productList(p, ctx.data)
    if (!list.length) return null
    const card = ctx.renderItem ? null : await siteCard(ctx.data)
    return (
      // A single product (a spotlight) fills its box: a four-column default would shrink it to a sliver.
      <ItemsLayout layout={p.layout} className={str(props.className)} itemClassName={p.itemClassName} label="Products" fallbackGrid={list.length === 1 ? 'grid grid-cols-1' : 'grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5'}>
        {items(list, ctx, (v, i) => (
          <ProductItem key={v.id ?? i} product={v} aspect={p.aspect} card={card} data={ctx.data} priority={!!card && i === 0 && ctx.claimPriority()} />
        ))}
      </ItemsLayout>
    )
  },
})

const CategoriesProps = z.object({
  parent: slug.nullish().describe('a category slug for its children; top-level categories when absent'),
  slugs: z.array(slug).max(24).optional(),
  limit: z.number().int().min(1).max(24).default(8),
  ...layoutProps,
})
defineCodeComponent({
  name: 'Categories',
  pages: 'any',
  props: CategoriesProps,
  binding: { id: 'category id', slug: 'url slug', name: 'category name', url: 'link to the category', image: 'image URL or null' },
  describe: 'Store categories. Without a render function each shows as a square picture with its name.',
  count: async (props, data) => {
    const p = props as z.infer<typeof CategoriesProps>
    return (await data.categories({ parent: p.parent ?? null, slugs: p.slugs, limit: p.limit })).length
  },
  async render(props, ctx) {
    const p = props as z.infer<typeof CategoriesProps>
    const list = await ctx.data.categories({ parent: p.parent ?? null, slugs: p.slugs, limit: p.limit })
    if (!list.length) return null
    return (
      <ItemsLayout layout={p.layout} className={str(props.className)} itemClassName={p.itemClassName} label="Categories" fallbackGrid="grid grid-cols-2 gap-4 md:grid-cols-4">
        {items(list, ctx, (c, i) => <CategoryTile key={c.id ?? i} c={c} priority={i === 0 && ctx.claimPriority()} fill={p.layout === 'mosaic'} />)}
      </ItemsLayout>
    )
  },
})

const BrandsProps = z.object({ slugs: z.array(slug).max(24).optional(), featured: z.boolean().optional(), limit: z.number().int().min(1).max(24).default(8), ...layoutProps })
defineCodeComponent({
  name: 'Brands',
  pages: 'any',
  props: BrandsProps,
  binding: { id: 'brand id', slug: 'url slug', name: 'brand name', url: 'link to the brand', logo: 'logo URL or null' },
  describe: 'Store brands. Without a render function each shows as its logo (or name) in a tile.',
  count: async (props, data) => {
    const p = props as z.infer<typeof BrandsProps>
    return (await data.brands({ slugs: p.slugs, featured: p.featured, limit: p.limit })).length
  },
  async render(props, ctx) {
    const p = props as z.infer<typeof BrandsProps>
    const list = await ctx.data.brands({ slugs: p.slugs, featured: p.featured, limit: p.limit })
    if (!list.length) return null
    return (
      <ItemsLayout layout={p.layout} className={str(props.className)} itemClassName={p.itemClassName} label="Brands" fallbackGrid="grid grid-cols-3 gap-3 md:grid-cols-6">
        {items(list, ctx, (b, i) => <BrandTile key={b.id ?? i} b={b} />)}
      </ItemsLayout>
    )
  },
})

const ReviewsProps = z.object({ productSlug: slug.optional(), minRating: z.number().int().min(1).max(5).default(4), limit: z.number().int().min(1).max(12).default(3), ...layoutProps })
defineCodeComponent({
  name: 'Reviews',
  pages: 'any',
  props: ReviewsProps,
  binding: {
    id: 'review id', rating: '1–5', stars: 'the rating as "★★★★☆"', title: 'title or null', comment: 'the review text', author: 'first name and initial',
    productName: 'product reviewed', productSlug: 'its slug', productUrl: 'link to it',
  },
  describe: 'Approved customer reviews, best first. Without a render function each shows as a quote card.',
  count: async (props, data) => {
    const p = props as z.infer<typeof ReviewsProps>
    return (await data.reviews({ productSlug: p.productSlug, minRating: p.minRating, limit: p.limit })).length
  },
  async render(props, ctx) {
    const p = props as z.infer<typeof ReviewsProps>
    const list = await ctx.data.reviews({ productSlug: p.productSlug, minRating: p.minRating, limit: p.limit })
    if (!list.length) return null
    return (
      <ItemsLayout layout={p.layout} className={str(props.className)} itemClassName={p.itemClassName} label="Reviews" fallbackGrid="grid gap-4 md:grid-cols-3">
        {items(list, ctx, (r, i) => <ReviewCard key={r.id ?? i} r={r} />)}
      </ItemsLayout>
    )
  },
})

const OffersProps = z.object({ limit: z.number().int().min(1).max(8).default(3), ...layoutProps })
defineCodeComponent({
  name: 'Offers',
  pages: 'any',
  props: OffersProps,
  binding: {
    id: 'offer id', slug: 'url slug', title: 'offer title', subtitle: 'subtitle or null', badge: 'badge text or null', image: 'image URL or null',
    mobileImage: 'phone image URL or null', url: 'link to the offer', cta: 'button label or null', endsAt: 'ISO end time or null (for <Countdown>)',
  },
  describe: 'Live offers. Without a render function each shows as a picture card.',
  count: async (props, data) => (await data.offers({ limit: (props as z.infer<typeof OffersProps>).limit })).length,
  async render(props, ctx) {
    const p = props as z.infer<typeof OffersProps>
    const list = await ctx.data.offers({ limit: p.limit })
    if (!list.length) return null
    return (
      <ItemsLayout layout={p.layout} className={str(props.className)} itemClassName={p.itemClassName} label="Offers" fallbackGrid="grid gap-4 md:grid-cols-3">
        {items(list, ctx, (o, i) => <OfferCard key={o.id ?? i} o={o} priority={i === 0 && ctx.claimPriority()} fill={p.layout === 'mosaic'} />)}
      </ItemsLayout>
    )
  },
})

/** What an opening picture shows: kind says where it came from ('none': the store has no picture yet). */
export interface HeroView {
  kind: 'offer' | 'product' | 'category' | 'none'
  image: string | null
  mobileImage: string | null
  title: string
  subtitle: string | null
  badge: string | null
  url: string
  cta: string | null
}

/** The store's best picture for its opening: a live offer's, else a featured (or the newest) product's, else a category's. */
export async function heroPicture(data: SiteData): Promise<HeroView> {
  const offer = (await data.offers({ limit: 8 }).catch(() => [] as OfferView[])).find(o => safeSrc(o.image) || safeSrc(o.mobileImage))
  if (offer)
    return { kind: 'offer', image: offer.image ?? offer.mobileImage, mobileImage: offer.mobileImage ?? offer.image, title: offer.title, subtitle: offer.subtitle, badge: offer.badge, url: offer.url, cta: offer.cta }
  const photo = async (q: Parameters<SiteData['products']>[0]) => (await data.products(q).catch(() => [] as ProductView[])).find(p => safeSrc(p.image))
  const product = (await photo({ featured: true, sort: 'featured', limit: 12 })) ?? (await photo({ sort: 'new', limit: 24 }))
  if (product) return { kind: 'product', image: product.image, mobileImage: product.image, title: product.name, subtitle: product.brand ?? product.category, badge: product.badge, url: product.url, cta: null }
  const category = (await data.categories({ parent: null, limit: 12 }).catch(() => [] as CategoryView[])).find(c => safeSrc(c.image))
  if (category) return { kind: 'category', image: category.image, mobileImage: category.image, title: category.name, subtitle: null, badge: null, url: category.url, cta: null }
  const store = await data.store().catch(() => null)
  return { kind: 'none', image: null, mobileImage: null, title: store?.name || 'Shop', subtitle: null, badge: null, url: '/products', cta: null }
}

const HeroPictureProps = z.object({
  aspect: z.enum(ASPECTS).default('4:5').describe('the picture shape without a render function'),
  fit: z.enum(['cover', 'contain']).default('cover'),
  sizes: z.string().max(200).regex(/^[\w\s(),.:%-]*$/).optional().describe('e.g. "(min-width: 1024px) 50vw, 100vw"'),
  priority: z.boolean().default(false).describe('load it eagerly even outside the first section'),
})
defineCodeComponent({
  name: 'HeroPicture',
  pages: 'any',
  props: HeroPictureProps,
  binding: {
    kind: '"offer" (a campaign picture made for a full-bleed banner), "product", "category", or "none" (no picture yet: <Image src={h.image}> draws a designed fill)',
    image: 'picture URL, or null when the store has none yet',
    mobileImage: 'picture for phones, or null',
    title: "what it shows: the offer's title, the product's or category's name, else the store's name",
    subtitle: 'subtitle or null',
    badge: 'badge text or null',
    url: 'where it leads: the offer, product or category (all products when none)',
    cta: "the offer's button label, or null",
  },
  describe:
    "The opening (hero) picture, always there: the first live offer's picture, else a featured (or the newest) product's photo, else a category's, else a designed fill in the theme's colours. Without a render function, the picture itself (aspect, fit). {h => …} to lay it out yourself; h.kind === 'offer' is a campaign picture made for a full-bleed banner.",
  async render(props, ctx) {
    const p = props as z.infer<typeof HeroPictureProps>
    const h = await heroPicture(ctx.data)
    if (ctx.renderItem) return ctx.renderItem(h, 0)
    return <CodeImage src={h.image} alt={h.title} aspect={p.aspect} fit={p.fit} sizes={p.sizes ?? '(min-width: 1024px) 50vw, 100vw'} priority={p.priority || ctx.claimPriority()} className={str(props.className)} />
  },
})

defineCodeComponent({
  name: 'Store',
  pages: 'any',
  props: z.object({}),
  binding: {
    name: 'store name', tagline: 'tagline (may be empty)', logo: 'logo URL or null', email: 'email', phone: 'phone', address: 'address line', about: 'about text', year: 'the current year',
    whatsapp: 'WhatsApp number as digits with the country code, or empty (link it as `https://wa.me/${s.whatsapp}`)',
  },
  describe: "The store's identity, once: <Store>{s => <p>© {s.year} {s.name}</p>}</Store>.",
  async render(_props, ctx) {
    if (!ctx.renderItem) return null
    return ctx.renderItem(await ctx.data.store(), 0)
  },
})

const ProductCardProps = z.object({ product: z.any().describe('a product from a render function: product={p}'), aspect: z.enum(ASPECTS).optional() })
defineCodeComponent({
  name: 'ProductCard',
  pages: 'any',
  props: ProductCardProps,
  describe: "The site's product card for one product (the same card every product list shows): <ProductCard product={p} />.",
  async render(props, ctx) {
    const p = props as z.infer<typeof ProductCardProps>
    if (!p.product || typeof p.product !== 'object') return null
    return <ProductItem product={p.product as ProductView} aspect={p.aspect} card={await siteCard(ctx.data)} data={ctx.data} />
  },
})

const ImageProps = z.object({
  src: z.string().max(2000).nullish().describe('https URL or a bound image (p.image); a styled placeholder shows when empty'),
  hoverSrc: z.string().max(2000).nullish().describe('a second image shown on hover'),
  alt: z.string().max(200).default(''),
  aspect: z.enum(ASPECTS).default('auto'),
  fit: z.enum(['cover', 'contain']).default('cover'),
  sizes: z.string().max(200).regex(/^[\w\s(),.:%-]*$/).optional().describe('e.g. "(min-width: 768px) 33vw, 100vw"'),
  priority: z.boolean().default(false).describe('true only for the first, above-the-fold image'),
})
defineCodeComponent({
  name: 'Image',
  pages: 'any',
  props: ImageProps,
  describe: 'A responsive, optimised image in a fixed shape (aspect), so nothing shifts while it loads.',
  render(props, ctx) {
    const p = props as z.infer<typeof ImageProps>
    return <CodeImage src={p.src} hoverSrc={p.hoverSrc} alt={p.alt} aspect={p.aspect} fit={p.fit} sizes={p.sizes} priority={p.priority || ctx.claimPriority()} className={str(props.className)} edit={ctx.edit} />
  },
})

const LinkProps = z.object({ href: z.string().max(2000).describe('a /path or https:// URL'), target: z.enum(['_blank', '_self']).optional() })
defineCodeComponent({
  name: 'Link',
  pages: 'any',
  props: LinkProps,
  describe: 'A link (site paths navigate instantly). Style it as a button with className.',
  render(props, ctx) {
    const p = props as z.infer<typeof LinkProps>
    return (
      <CodeLink href={p.href} target={p.target} className={str(props.className)} edit={ctx.edit}>
        {ctx.children}
      </CodeLink>
    )
  },
})

const IconProps = z.object({ name: z.enum(CODE_ICON_NAMES), size: z.enum(['xs', 'sm', 'md', 'lg', 'xl']).default('md'), strokeWidth: z.number().min(0.5).max(3).default(1.75) })
defineCodeComponent({
  name: 'Icon',
  pages: 'any',
  props: IconProps,
  describe: 'A line icon; colour it with a text-* class.',
  render(props, ctx) {
    const p = props as z.infer<typeof IconProps>
    return <CodeIcon name={p.name} size={p.size} strokeWidth={p.strokeWidth} className={str(props.className)} edit={ctx.edit} />
  },
})

const CarouselProps = z.object({ itemClassName: z.string().max(200).optional().describe('slide widths, e.g. "w-[85%] md:w-[45%]"'), label: z.string().max(80).default('Slides') })
defineCodeComponent({
  name: 'Carousel',
  pages: 'any',
  props: CarouselProps,
  describe: 'A swipeable row of slides (each child is a slide) with arrows on desktop. For products use <Products layout="carousel">.',
  render(props, ctx) {
    const p = props as z.infer<typeof CarouselProps>
    const slides = childArray(ctx.children)
    if (!slides.length) return null
    return (
      <div className={str(props.className)}>
        <SectionCarousel ariaLabel={p.label} itemClassName={p.itemClassName || 'w-[85%] md:w-[45%]'}>
          {slides}
        </SectionCarousel>
      </div>
    )
  },
})

/** The interpreter hands children as one fragment; sliders and tabs want them one by one. */
function childArray(children: ReactNode): ReactNode[] {
  const el = children as ReactElement<{ children?: ReactNode }> | null
  const inner = el && typeof el === 'object' && 'props' in el ? el.props.children : children
  return (Array.isArray(inner) ? inner : [inner]).flat(Infinity as 1).filter(c => c != null && c !== false && c !== '')
}

const TabsProps = z.object({ variant: z.enum(['underline', 'pills', 'boxed']).default('underline'), align: z.enum(['left', 'center']).default('left') })
defineCodeComponent({
  name: 'Tabs',
  pages: 'any',
  props: TabsProps,
  describe: 'Tabs: put <Tab label="…"> children inside; each tab shows its own content.',
  render(props, ctx) {
    const p = props as z.infer<typeof TabsProps>
    const tabs = childArray(ctx.children)
    if (!tabs.length) return null
    return (
      <Tabs variant={p.variant} align={p.align} className={str(props.className)}>
        {tabs}
      </Tabs>
    )
  },
})
defineCodeComponent({
  name: 'Tab',
  pages: 'any',
  props: z.object({ label: z.string().trim().min(1).max(60) }),
  describe: 'One tab inside <Tabs>, with its label.',
  render(props, ctx) {
    return <TabPanel label={String(props.label)}>{ctx.children}</TabPanel>
  },
})

const AccordionProps = z.object({ multiple: z.boolean().default(false).describe('let several items be open at once'), defaultOpen: z.boolean().default(false).describe('open the first item') })
defineCodeComponent({
  name: 'Accordion',
  pages: 'any',
  props: AccordionProps,
  describe: 'Questions or details that open one at a time: <AccordionItem title="…"> children.',
  render(props, ctx) {
    const p = props as z.infer<typeof AccordionProps>
    const kids = childArray(ctx.children)
    return (
      <Accordion multiple={p.multiple} defaultOpen={p.defaultOpen} className={str(props.className)}>
        {kids}
      </Accordion>
    )
  },
})
defineCodeComponent({
  name: 'AccordionItem',
  pages: 'any',
  props: z.object({ title: z.string().trim().min(1).max(200), first: z.boolean().default(false).describe('the item Accordion defaultOpen opens') }),
  describe: 'One item inside <Accordion>: its title opens its content.',
  render(props, ctx) {
    return (
      <AccordionItem title={String(props.title)} first={!!props.first} className={str(props.className)}>
        {ctx.children}
      </AccordionItem>
    )
  },
})

const MarqueeProps = z.object({ speed: z.enum(['slow', 'normal', 'fast']).default('normal'), direction: z.enum(['left', 'right']).default('left'), pauseOnHover: z.boolean().default(true) })
defineCodeComponent({
  name: 'Marquee',
  pages: 'any',
  props: MarqueeProps,
  describe: 'An endlessly scrolling strip of its children (text, icons, logos). Still for reduced motion.',
  render(props, ctx) {
    const p = props as z.infer<typeof MarqueeProps>
    return (
      <Marquee speed={p.speed} direction={p.direction} pauseOnHover={p.pauseOnHover} className={str(props.className)}>
        {childArray(ctx.children)}
      </Marquee>
    )
  },
})

const RevealProps = z.object({ effect: z.enum(['fade-up', 'fade', 'zoom', 'slide-left', 'slide-right']).default('fade-up'), delay: z.number().min(0).max(2).default(0).describe('seconds') })
defineCodeComponent({
  name: 'Reveal',
  pages: 'any',
  props: RevealProps,
  describe: 'Eases its children in when they scroll into view (once). Stagger with delay.',
  render(props, ctx) {
    const p = props as z.infer<typeof RevealProps>
    return (
      <Reveal effect={p.effect} delay={p.delay} className={str(props.className)}>
        {ctx.children}
      </Reveal>
    )
  },
})

const CountdownProps = z.object({
  endsAt: z.string().max(40).describe('ISO date-time, or a bound one (o.endsAt)'),
  label: z.string().max(80).optional(),
  variant: z.enum(['boxes', 'inline']).default('boxes'),
})
defineCodeComponent({
  name: 'Countdown',
  pages: 'any',
  props: CountdownProps,
  describe: 'A ticking countdown to a date; it hides once the time has passed.',
  render(props) {
    const p = props as z.infer<typeof CountdownProps>
    const end = Date.parse(p.endsAt)
    if (!Number.isFinite(end) || end <= Date.now()) return null
    return <Countdown endsAt={p.endsAt} label={p.label} variant={p.variant} className={str(props.className)} />
  },
})
