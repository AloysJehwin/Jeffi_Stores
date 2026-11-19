import type { CodeNode, CodeValue } from '@/lib/site/code/ast'
import { splitClasses } from '@/lib/site/code/allow'

// What a code section's loading skeleton is drawn with (lib/site/code/skeleton.ts): the shimmer pieces and a skeleton
// per library part, as code-section AST for the interpreter. Every class is written out here, under components/, so
// each app's Tailwind build has it (a section's compiled CSS covers only the AI's own classes). Colours are theme
// tokens; the `sk` sweep stands still for reduced motion (globals.css). Responsive variants beside a base class are
// important (md:!grid-cols-4): the section's scoped rule for the base class reaches these elements too, and would win.

type N = CodeNode
type Cls = CodeValue | null
type Props = Record<string, unknown>
const lit = (v: string): CodeValue => ({ k: 'lit', v })

export function h(tag: string, cls: Cls | string | undefined, ...children: (N | null | false | undefined)[]): N {
  const className = typeof cls === 'string' ? (cls.trim() ? lit(cls) : null) : (cls ?? null)
  return { t: 'el', tag, props: className ? { className } : {}, children: children.filter((c): c is N => !!c) }
}
export const txt = (value: string): N => ({ t: 'text', value })
export const frag = (children: N[]): N => (children.length === 1 ? children[0] : { t: 'frag', children })
export const EMPTY: N = { t: 'frag', children: [] }
/** `body` n times, drawn by the interpreter; `index` names the item index its classes and tests read. */
export const repeat = (n: number, body: N, index?: string): N => ({
  t: 'each',
  items: { k: 'lit', v: Array.from({ length: n }, (_, i) => i) },
  param: '$sk',
  ...(index ? { index } : {}),
  body,
})

// ── Class values ──────────────────────────────────────────────────────────────────────────────────

/** Every class string a class value can take (each side of a ternary, a template's text). */
export function classStrings(v: Cls | undefined): string[] {
  if (!v) return []
  if (v.k === 'lit') return typeof v.v === 'string' ? [v.v] : []
  if (v.k === 'tpl') return v.parts.flatMap(p => (typeof p === 'string' ? [p] : classStrings(p)))
  if (v.k === 'cond') return [...classStrings(v.then), ...classStrings(v.else)]
  return []
}
export const classList = (v: Cls | undefined) => classStrings(v).flatMap(splitClasses)

function mapClasses(v: CodeValue, fn: (s: string) => string): CodeValue {
  if (v.k === 'lit') return typeof v.v === 'string' ? lit(fn(v.v)) : v
  if (v.k === 'tpl') return { k: 'tpl', parts: v.parts.map(p => (typeof p === 'string' ? fn(p) : mapClasses(p, fn))) }
  if (v.k === 'cond') return { ...v, then: mapClasses(v.then, fn), else: mapClasses(v.else, fn) }
  return v
}

/** Classes added to a section's class value (a string, or one picked at render). */
export function withCls(v: Cls | undefined, extra: string): CodeValue {
  if (!v) return lit(extra)
  if (v.k === 'lit') return lit(typeof v.v === 'string' && v.v.trim() ? `${v.v.trim()} ${extra}` : extra)
  return { k: 'tpl', parts: [v, ` ${extra}`] }
}

/** A class's utility without its variants (md:, hover:…), important mark or minus sign. */
export function baseOf(c: string): string {
  let depth = 0
  let cut = 0
  for (let i = 0; i < c.length; i++) {
    if (c[i] === '[') depth++
    else if (c[i] === ']') depth--
    else if (c[i] === ':' && depth === 0) cut = i + 1
  }
  return c.slice(cut).replace(/^!?-?/, '')
}
export const unvaried = (c: string) => baseOf(c) === c.replace(/^!?-?/, '')

// Backgrounds, gradients and text colours (not text sizes or alignment): a pill drops them for the shimmer's own.
const COLOUR = /^(bg|from|via|to|fill|stroke|decoration|caret|placeholder)-|^text-(?!(xs|sm|base|lg|[2-9]?xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$)(?!\[(?!#|rgb|hsl|color:))/
export const stripColours = (v: Cls | undefined): Cls =>
  v ? mapClasses(v, s => s.replace(/\S+/g, c => (COLOUR.test(baseOf(c)) ? '' : c)).replace(/\s+/g, ' ')) : null

// ── Shimmer pieces ────────────────────────────────────────────────────────────────────────────────

/** A run of the section's text: its height and width scale with the text's font, so a heading's bar is tall. */
export const BAR = 'sk inline-block h-[0.7em] max-w-full rounded bg-border-default'
const WIDTHS: [number, string][] = [
  [2, 'w-[2ch]'], [3, 'w-[3ch]'], [4, 'w-[4ch]'], [5, 'w-[5ch]'], [6, 'w-[6ch]'], [7, 'w-[7ch]'], [8, 'w-[8ch]'], [10, 'w-[10ch]'],
  [12, 'w-[12ch]'], [14, 'w-[14ch]'], [16, 'w-[16ch]'], [18, 'w-[18ch]'], [20, 'w-[20ch]'], [22, 'w-[22ch]'], [24, 'w-[24ch]'],
  [26, 'w-[26ch]'], [28, 'w-[28ch]'],
]
/** A bar about `ch` characters of its font wide. */
export function bar(ch: number): N {
  let w = WIDTHS[0]
  for (const x of WIDTHS) if (Math.abs(x[0] - ch) < Math.abs(w[0] - ch)) w = x
  return h('span', `${BAR} ${w[1]}`)
}
/** A button or a link styled as one: its own size and shape, its colours gone and its text hidden. */
export const PILL = 'sk rounded-full bg-border-default text-transparent'
export const ICON = 'sk inline-block shrink-0 rounded bg-border-default'
/** An icon inside a pill: only its room. */
export const ICON_BOX = 'inline-block shrink-0'
export const ICON_SIZE: Record<string, string> = { xs: 'h-3.5 w-3.5', sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8', xl: 'h-12 w-12' }
export const ASPECT: Record<string, string> = {
  '1:1': 'aspect-square', '4:5': 'aspect-[4/5]', '3:4': 'aspect-[3/4]', '2:3': 'aspect-[2/3]', '4:3': 'aspect-[4/3]', '3:2': 'aspect-[3/2]',
  '16:9': 'aspect-video', '21:9': 'aspect-[21/9]', '3:1': 'aspect-[3/1]',
}

const SIZED_H = /^(h|size|aspect|min-h|inset|inset-y)-|^(flex-1|grow|flex-grow)$/
const SIZED_W = /^(w|size|min-w|inset|inset-x|basis)-|^(flex-1|grow|flex-grow)$/
/** A picture: a shimmer block with the section's classes, in the picture's place and size (CodeImage's shape when it has none). */
export function picture(cls: Cls, aspect?: unknown): N {
  const own = classList(cls).filter(unvaried).map(baseOf)
  const box = typeof aspect === 'string' ? ASPECT[aspect] : undefined
  const height = box ?? (own.some(c => SIZED_H.test(c)) ? '' : 'aspect-[4/3]')
  const width = own.some(c => SIZED_W.test(c)) ? '' : 'w-full'
  return h('span', withCls(cls, ['sk block bg-border-default/50', height, width].filter(Boolean).join(' ')))
}

// Layouts the parts draw their items in (ItemsLayout, SectionCarousel, the islands).
export const LIST = 'flex flex-col gap-4'
export const RAIL = 'flex gap-3 overflow-hidden md:!gap-5'
export const SLIDE = 'shrink-0'
export const RAIL_ITEM = 'w-[45%] md:!w-[23%]'
export const SLIDE_ITEM = 'w-[85%] md:!w-[45%]'
export const MOSAIC =
  'grid grid-cols-2 [gap:0.75rem] [grid-auto-rows:11rem] sm:[gap:1rem] sm:[grid-auto-rows:13rem] lg:!grid-cols-12 lg:[gap:1.25rem] lg:[grid-auto-rows:15rem]'
export const MARQUEE_BOX = 'overflow-hidden'
export const MARQUEE = 'flex w-max items-center gap-10 whitespace-nowrap'
export const TABS: Record<string, { list: string; tab: string; on: string; off: string }> = {
  underline: { list: 'flex gap-6 overflow-x-auto border-b border-border-default', tab: '-mb-px whitespace-nowrap border-b-2 pb-3 text-sm font-semibold', on: 'border-accent-500', off: 'border-transparent' },
  pills: { list: 'flex gap-2 overflow-x-auto', tab: 'whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold', on: 'bg-foreground', off: 'bg-surface-secondary' },
  boxed: { list: 'inline-flex gap-1 overflow-x-auto rounded-[var(--radius-button,0.5rem)] bg-surface-secondary p-1', tab: 'whitespace-nowrap rounded-[var(--radius-button,0.5rem)] px-4 py-2 text-sm font-semibold', on: 'bg-surface shadow-sm', off: '' },
}
export const TAB_CENTER = 'justify-center'
export const TAB_PANEL = 'pt-6'
export const ACCORDION = 'divide-y divide-border-default border-y border-border-default'
export const ACCORDION_ROW = 'flex min-h-[52px] w-full items-center justify-between gap-4 py-3 text-left font-medium'
export const CHEVRON = `${ICON} h-5 w-5`

// ── Parts ─────────────────────────────────────────────────────────────────────────────────────────

const line = (cls: string) => h('span', `sk block rounded bg-border-default ${cls}`)
const block = (cls: string) => h('span', `sk block bg-border-default/50 ${cls}`)
const button = (cls: string) => h('span', `sk block rounded-[var(--radius-button,0.5rem)] bg-border-default ${cls}`)
const circle = (cls: string) => h('span', `sk block shrink-0 rounded-full bg-border-default ${cls}`)
const chip = () => h('span', 'sk inline-block h-9 w-24 rounded-full bg-border-default')
const LINES = ['w-full', 'w-11/12', 'w-4/5', 'w-full', 'w-2/3', 'w-3/4']
const lines = (n: number) => h('div', 'space-y-2', ...Array.from({ length: n }, (_, i) => line(`h-3.5 ${LINES[i % LINES.length]}`)))
const card = (...kids: (N | null)[]) => h('div', 'space-y-4 rounded-[var(--radius-card,0.75rem)] border border-border-default bg-surface-elevated p-5', ...kids)
const totals = (n: number) => repeat(n, h('div', 'flex justify-between gap-4', line('h-3.5 w-24'), line('h-3.5 w-16')))
const doc = () => h('div', 'space-y-4', line('h-8 w-64 max-w-full'), lines(6), line('mt-6 h-6 w-48'), lines(4))
const authCard = (fields: number) =>
  h(
    'div',
    'mx-auto w-full max-w-md space-y-4 rounded-2xl border border-border-default bg-surface-elevated p-6',
    repeat(fields, h('div', 'space-y-2', line('h-3.5 w-24'), block('h-11 w-full rounded-lg'))),
    button('h-11 w-full'),
    line('mx-auto h-3.5 w-40')
  )
const filled = (p: Props) => p.layout === 'mosaic'
const FILL = 'h-full min-h-[8rem] w-full rounded-[var(--radius-card,0.75rem)]'

/** The site's product card, as a picture and three lines (the store's own card may differ: it is drawn per store). */
export const productCard = (aspect?: unknown) =>
  h('div', 'flex h-full flex-col', block(`w-full rounded-[var(--radius-card,0.75rem)] ${ASPECT[String(aspect)] ?? 'aspect-[4/5]'}`), line('mt-3 h-3.5 w-4/5'), line('mt-2 h-3.5 w-1/2'), line('mt-3 h-4 w-1/3'))
const product = (p: Props) => productCard(p.aspect)
const categoryTile = (p: Props) => (filled(p) ? block(FILL) : h('div', null, block('aspect-square w-full rounded-[var(--radius-card,0.75rem)]'), line('mt-2 h-3.5 w-2/3')))
const quote = () => h('div', 'h-full space-y-3 rounded-[var(--radius-card,0.75rem)] border border-border-default bg-surface p-5', line('h-4 w-24'), lines(3), line('h-3 w-1/3'))
const faq = () => h('div', ACCORDION_ROW, line('h-4 w-2/3'), h('span', CHEVRON))

export interface ListSkeleton {
  /** Items drawn when the props don't say. */
  n: number
  /** The list's own layout when the section gives it no className. */
  grid: string | ((p: Props) => string)
  /** An item without a render function. */
  tile: (p: Props) => N
  /** A carousel item's width when the section gives none. */
  rail?: string
}
const RESULTS: Record<number, string> = {
  2: 'grid grid-flow-row-dense grid-cols-2 gap-3 sm:!gap-6',
  3: 'grid grid-flow-row-dense grid-cols-2 gap-3 sm:!gap-6 lg:!grid-cols-3',
  4: 'grid grid-flow-row-dense grid-cols-2 gap-3 sm:!gap-6 lg:!grid-cols-3 xl:!grid-cols-4',
}
/** The parts that draw a list: a few repeats of their item (the section's render function, or the default tile). */
export const LISTS: Record<string, ListSkeleton> = {
  Products: { n: 8, grid: 'grid grid-cols-2 gap-3 md:!grid-cols-4 md:!gap-5', tile: product },
  RelatedProducts: { n: 4, grid: 'grid grid-cols-2 gap-4 lg:!grid-cols-4', tile: product },
  CartUpsell: { n: 4, grid: 'grid grid-cols-2 gap-3 md:!grid-cols-4', tile: product },
  ProductResults: { n: 8, grid: p => RESULTS[Number(p.columns)] ?? RESULTS[3], tile: product },
  Categories: { n: 8, grid: 'grid grid-cols-2 gap-4 md:!grid-cols-4', tile: categoryTile },
  SubCategories: { n: 6, grid: 'flex flex-wrap gap-2', tile: p => (p.variant === 'tiles' ? categoryTile(p) : chip()) },
  AllCategories: {
    n: 8,
    grid: 'grid grid-cols-1 gap-5 sm:!grid-cols-2 lg:!grid-cols-3',
    tile: p => (filled(p) ? block(FILL) : h('div', 'space-y-3', block('aspect-[4/3] w-full rounded-[var(--radius-card,0.75rem)]'), line('h-5 w-1/2'), line('h-3.5 w-1/3'))),
  },
  Brands: { n: 8, grid: 'grid grid-cols-3 gap-3 md:!grid-cols-6', tile: () => h('div', 'flex h-20 items-center justify-center rounded-[var(--radius-card,0.75rem)] border border-border-default bg-surface px-3', line('h-4 w-20')) },
  AllBrands: {
    n: 8,
    grid: 'grid grid-cols-2 gap-4 sm:!grid-cols-3 lg:!grid-cols-4',
    tile: () => h('div', 'flex flex-col items-center gap-3 rounded-[var(--radius-card,0.75rem)] border border-border-default bg-surface p-5', block('h-14 w-24 rounded-lg'), line('h-4 w-20'), line('h-3 w-16')),
  },
  Reviews: { n: 3, grid: 'grid gap-4 md:grid-cols-3', tile: quote },
  Testimonials: { n: 3, grid: 'grid gap-5 md:grid-cols-3', tile: quote, rail: 'w-[85%] md:!w-[32%]' },
  Offers: { n: 3, grid: 'grid gap-4 md:grid-cols-3', tile: p => block(filled(p) ? FILL : 'aspect-[4/5] w-full rounded-[var(--radius-card,0.75rem)]') },
  Services: { n: 6, grid: 'grid grid-cols-1 gap-5 sm:!grid-cols-2 lg:!grid-cols-3', tile: p => h('div', 'space-y-3', block(`w-full rounded-[var(--radius-card,0.75rem)] ${ASPECT[String(p.aspect)] ?? 'aspect-[4/3]'}`), line('h-5 w-2/3'), lines(2)) },
  Work: { n: 6, grid: 'grid grid-cols-2 gap-3 md:!grid-cols-3 md:!gap-5', tile: p => block(filled(p) ? FILL : `w-full rounded-[var(--radius-card,0.75rem)] ${ASPECT[String(p.aspect)] ?? 'aspect-square'}`) },
  Stats: { n: 4, grid: 'grid grid-cols-2 gap-6 md:!grid-cols-4', tile: () => h('div', 'space-y-2', line('h-9 w-20'), line('h-3.5 w-24')) },
  Faqs: { n: 5, grid: ACCORDION, tile: faq },
  CategoryFaqs: { n: 4, grid: ACCORDION, tile: faq },
  Breadcrumbs: { n: 3, grid: 'flex flex-wrap items-center gap-2 text-sm', tile: () => h('span', 'flex items-center gap-2', bar(8), txt('/')) },
  NavLinks: { n: 5, grid: 'flex flex-wrap items-center gap-6', tile: () => bar(8) },
  FooterLinks: { n: 3, grid: 'grid grid-cols-2 gap-8 md:!grid-cols-3', tile: () => h('div', 'space-y-3', line('h-4 w-24'), line('h-3.5 w-20'), line('h-3.5 w-28'), line('h-3.5 w-16')) },
  SocialLinks: { n: 3, grid: 'flex items-center gap-3', tile: () => circle('h-8 w-8') },
}

type Part = (p: Props, cls: Cls) => N
const gallery = (layout: unknown) =>
  layout === 'grid'
    ? h('div', 'grid grid-cols-2 gap-3', repeat(4, block('aspect-square w-full rounded-xl')))
    : layout === 'stacked'
      ? h('div', 'space-y-3', repeat(2, block('aspect-square w-full rounded-xl')))
      : h('div', null, block('aspect-square w-full rounded-xl'), h('div', 'mt-3 grid grid-cols-4 gap-3', repeat(4, block('aspect-square w-full rounded-lg'))))

/** The other parts, drawn without the section's help; `cls` is the className the section gave the part. */
export const PARTS: Record<string, Part> = {
  // Records without a render function.
  Store: () => EMPTY,
  Product: () => EMPTY,
  Business: () => EMPTY,
  HeroPicture: (p, cls) => picture(cls, p.aspect ?? '4:5'),
  BusinessPicture: (p, cls) => picture(cls, p.aspect ?? '4:5'),
  Category: (_p, cls) => h('div', cls, line('h-9 w-56 max-w-full'), line('mt-3 h-4 w-80 max-w-full'), block('mt-6 aspect-[3/1] w-full rounded-[var(--radius-card,0.75rem)]')),
  Brand: (_p, cls) => h('div', cls, h('div', 'flex items-center gap-4', block('h-16 w-16 shrink-0 rounded-lg'), h('div', 'flex-1 space-y-2', line('h-9 w-56 max-w-full'), line('h-4 w-80 max-w-full')))),
  SearchQuery: (_p, cls) => h('div', cls, line('h-8 w-64 max-w-full')),
  SeoText: (_p, cls) => h('div', cls, lines(4)),
  ProductCard: p => productCard(p.aspect),
  // Product page.
  ProductGallery: (p, cls) => h('div', cls, gallery(p.layout)),
  ProductTitle: (p, cls) => h(p.as === 'h2' ? 'h2' : 'h1', cls ?? 'text-2xl font-bold sm:!text-3xl', bar(20), txt(' '), bar(12)),
  ProductPrice: (p, cls) => h('div', cls, h('div', 'space-y-2', line('h-8 w-32'), p.size === 'compact' ? null : line('h-3.5 w-48'))),
  ProductRating: (_p, cls) => h('div', cls, line('h-4 w-32')),
  VariantPicker: (p, cls) =>
    h('div', cls, h('div', 'space-y-2', line('h-3.5 w-20'), p.style === 'dropdown' ? block('h-11 w-full rounded-lg') : h('div', 'flex flex-wrap gap-2', repeat(4, p.style === 'swatches' ? circle('h-9 w-9') : button('h-10 w-16'))))),
  QuantityPicker: (_p, cls) => h('div', cls, button('h-11 w-36')),
  AddToCart: (_p, cls) => h('div', cls, button('h-12 w-full')),
  BuyNow: (_p, cls) => h('div', cls, button('h-12 w-full')),
  WishlistButton: (_p, cls) => h('div', cls, circle('h-10 w-10')),
  DeliveryCheck: (p, cls) =>
    h('div', cls, card(line('h-3 w-28'), h('div', 'flex gap-2', block('h-10 flex-1 rounded-lg'), button('h-10 w-20'))), p.policies === false ? null : h('div', 'mt-3 grid grid-cols-2 gap-3', repeat(4, block('h-14 w-full rounded-xl')))),
  ProductDescription: (p, cls) => h('div', cls, p.card === false ? lines(5) : card(line('h-6 w-48'), lines(5))),
  ProductSpecs: (_p, cls) => h('div', cls, card(line('h-6 w-40'), repeat(6, h('div', 'flex justify-between gap-4', line('h-3.5 w-1/3'), line('h-3.5 w-1/4'))))),
  ProductReviews: (_p, cls) => h('div', cls, card(line('h-6 w-44'), h('div', 'flex gap-6', block('h-24 w-32 shrink-0 rounded-xl'), h('div', 'flex-1', lines(3))))),
  // Listings.
  Filters: (p, cls) =>
    h('div', cls, p.layout === 'drawer' || p.layout === 'top' ? button('h-10 w-28') : h('div', null, h('div', 'hidden space-y-6 lg:!block', repeat(3, h('div', 'space-y-3', line('h-4 w-24'), lines(4)))), button('h-10 w-28 lg:!hidden'))),
  SortMenu: (_p, cls) => h('div', cls, button('h-9 w-44')),
  ResultCount: (p, cls) => h('p', cls, bar(p.range === true ? 28 : 12)),
  // Cart and checkout.
  CartLines: (p, cls) =>
    h(
      'div',
      cls,
      p.variant === 'cards'
        ? h('div', 'grid grid-cols-1 gap-4 sm:!grid-cols-2', repeat(2, productCard()))
        : h('div', 'space-y-4', repeat(3, h('div', 'flex gap-4 rounded-xl border border-border-default p-4', block('h-20 w-20 shrink-0 rounded-lg'), h('div', 'flex-1 space-y-2', line('h-4 w-3/4'), line('h-3.5 w-1/3'), line('mt-3 h-8 w-28')))))
    ),
  CartSummary: (_p, cls) => h('div', cls, h('div', 'space-y-3', totals(3), line('h-5 w-full'))),
  CouponBox: (_p, cls) => h('div', cls, h('div', 'flex gap-2', block('h-10 flex-1 rounded-lg'), button('h-10 w-24'))),
  FreeShippingProgress: (_p, cls) => h('div', cls, h('div', 'space-y-2', line('h-3.5 w-2/3'), block('h-2 w-full rounded-full'))),
  CheckoutButton: (_p, cls) => h('div', cls, button('h-12 w-full')),
  // Shown only for an empty cart, which a loading screen can't know.
  CartEmpty: () => EMPTY,
  ContactForm: (_p, cls) => h('div', cls, card(line('h-5 w-40'), lines(3))),
  AddressForm: (_p, cls) => h('div', cls, card(line('h-5 w-40'), lines(3))),
  DeliveryOptions: (_p, cls) => h('div', cls, h('div', 'space-y-3', repeat(2, block('h-14 w-full rounded-lg')), block('h-20 w-full rounded-lg'))),
  OrderSummary: (_p, cls) => h('div', cls, card(line('h-5 w-36'), repeat(2, h('div', 'flex gap-3', block('h-14 w-14 shrink-0 rounded-lg'), h('div', 'flex-1', lines(2)))), totals(4))),
  TrustBadges: (_p, cls) => h('div', cls ?? 'grid grid-cols-2 gap-3', repeat(4, h('div', 'flex items-center gap-3', circle('h-9 w-9'), h('div', 'flex-1 space-y-1.5', line('h-3.5 w-2/3'), line('h-3 w-full'))))),
  PaymentStep: (_p, cls) => h('div', cls, card(line('h-5 w-40'), repeat(3, block('h-14 w-full rounded-lg')), button('h-12 w-full'))),
  // Working pages.
  SignInForm: (_p, cls) => h('div', cls, authCard(1)),
  SignUpForm: (_p, cls) => h('div', cls, authCard(3)),
  AccountPage: (_p, cls) => h('div', cls, h('div', 'space-y-6', line('h-7 w-48'), h('div', 'grid gap-4 sm:grid-cols-3', repeat(3, block('h-28 w-full rounded-xl'))), repeat(3, block('h-20 w-full rounded-xl')))),
  OrderDetail: (_p, cls) => h('div', cls, h('div', 'space-y-6', line('h-7 w-56'), block('h-32 w-full rounded-xl'), repeat(3, block('h-20 w-full rounded-xl')))),
  WishlistGrid: (_p, cls) => h('div', cls, h('div', 'grid grid-cols-2 gap-4 md:!grid-cols-4', repeat(4, productCard()))),
  CompareTable: (_p, cls) => h('div', cls, h('div', 'grid grid-cols-3 gap-4', repeat(3, h('div', 'space-y-3', block('aspect-square w-full rounded-lg'), lines(3))))),
  LegalContent: (_p, cls) => h('div', cls, doc()),
  ReturnsContent: (_p, cls) => h('div', cls, doc()),
  SupportContent: (_p, cls) => h('div', cls, h('div', 'grid gap-4 md:grid-cols-3', repeat(3, block('h-32 w-full rounded-xl')))),
  NotFoundContent: (_p, cls) => h('div', cls, h('div', 'space-y-4', block('h-11 w-full max-w-md rounded-full'), h('div', 'flex flex-wrap gap-2', repeat(4, chip())))),
  LeadForm: (_p, cls) => h('div', cls, card(repeat(3, block('h-11 w-full rounded-lg')), block('h-24 w-full rounded-lg'), button('h-11 w-full'))),
  // Header and footer.
  Logo: (_p, cls) => h('span', cls ?? 'flex min-w-0 items-center', h('span', 'flex items-center gap-2', circle('h-9 w-9'), bar(12))),
  SearchBox: (p, cls) => h('div', cls, p.variant === 'bar' ? block('h-10 w-full max-w-md rounded-full') : circle('h-9 w-9')),
  CartIcon: (_p, cls) => h('span', cls, circle('h-9 w-9')),
  AccountLink: (p, cls) => h('span', cls ?? 'flex items-center gap-2', circle('h-8 w-8'), p.label === '' ? null : bar(8)),
  AnnouncementText: (_p, cls) => h('span', cls, bar(28)),
  NewsletterForm: (_p, cls) => h('div', cls ?? 'flex w-full max-w-md gap-2', block('h-11 flex-1 rounded-lg'), button('h-11 w-28')),
  // A product card's parts.
  QuickAdd: (_p, cls) => (cls ? h('span', withCls(stripColours(cls), PILL), txt('Add to cart')) : button('h-10 w-full')),
  WishlistToggle: (_p, cls) => (cls ? h('span', withCls(stripColours(cls), 'sk block rounded-full bg-border-default')) : circle('h-9 w-9')),
  PriceTag: (_p, cls) => h('span', cls, bar(8)),
  DiscountBadge: (_p, cls) => h('span', cls ? withCls(stripColours(cls), PILL) : 'sk inline-block rounded-full bg-border-default px-2 py-0.5 text-xs text-transparent', txt('-20%')),
  StockBadge: (_p, cls) => h('span', cls, bar(8)),
  RatingStars: (_p, cls) => h('span', cls, bar(10)),
  Countdown: (p, cls) =>
    p.variant === 'inline' ? h('span', cls, bar(11)) : h('div', withCls(cls, 'inline-flex flex-col items-center gap-2'), h('div', 'flex gap-2', repeat(4, block('h-14 w-14 rounded-[var(--radius-button,0.5rem)]')))),
}

/** A part this file doesn't know: a block where it goes. */
export const unknownPart = (cls: Cls) => h('div', cls, block('h-24 w-full rounded-xl'))
