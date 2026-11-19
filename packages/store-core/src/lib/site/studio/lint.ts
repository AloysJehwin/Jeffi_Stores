import type { PageKey } from '@jeffi/site-blocks'
import { CARD_PRODUCT, carouselList, type CodeNode, type CodeValue } from '../code/ast'
import { splitClasses, taxonomyOf } from '../code/allow'
import { checkGrid, gridTrouble, PHONE as PHONE_WIDTH } from '../code/grid'
import { placeholderRows } from '../code/placeholders'

// What a studio section must not hard-code. It is written against a sample catalogue but goes live on the store's own,
// which starts empty and later has its own categories, brands and products: names, slugs, prices and contact details
// typed into the code would be wrong there. Each finding goes back to the model to repair; the renderer also copes
// (empty data hides, unknown category links go to the listing), so a section that still has one is kept.

const TAXONOMY_PROPS: Record<string, string[]> = {
  Products: ['category', 'brand', 'slugs'],
  Categories: ['slugs', 'parent'],
  Brands: ['slugs'],
  Reviews: ['productSlug'],
}

const lit = (v: CodeValue | undefined) => (v && v.k === 'lit' ? v.v : undefined)
const has = (v: unknown) => v != null && v !== '' && !(Array.isArray(v) && !v.length)

const PRICE = /₹\s?\d|\bRs\.?\s?\d|\bINR\s?\d/i
const PHONE = /(\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/

export const LINT = {
  taxonomy:
    'Do not name categories, brands or products by slug: the live store has its own. List them with <Categories>/<Brands> and link with c.url / b.url / p.url; filter <Products> by sort, featured or onSale only. On a category or brand page the page\'s own category or brand is <Category>/<Brand>, its subcategories <SubCategories> and its products <ProductResults>.',
  link: 'Do not link to a category, brand or product by a typed path: link with c.url, b.url or p.url from a data component (the all-categories and all-brands pages are /categories and /brands).',
  image: 'Every <Image> needs a src from data (p.image, c.image, b.logo, b.image, o.image, s.logo). Where there is no picture, design with colour, type and icons instead of an empty <Image>.',
  price: 'Do not type prices: they come from the data components (p.price.formatted).',
  contact: 'Do not type a phone number or email: use <Store>{s => …}</Store> (s.phone, s.email).',
  newsletter: 'The store has no mailing list: no newsletter or sign-up section (NewsletterForm draws nothing). Use SocialLinks or a call to shop instead.',
  heading:
    "Every category (or brand) wears this page: its h1 is the page's own name, never typed: <Category>{c => <h1>{c.name}</h1>}</Category> (<Brand>{b => …}</Brand> on a brand page).",
  hero: "The opening section needs a picture that is always there: <HeroPicture> (the first live offer's picture, else a featured product's photo, else a category's, else a designed fill). A store may have no offers or photos yet, so never take the opening's only picture from <Offers>, and never leave it without one.",
  showcaseHero: "The opening section needs a picture that is always there: <BusinessPicture> (the owner's work photo, else a picture made for this page, else a designed fill). The business may have no work photos yet, so never take the opening's only picture from <Work>.",
  standIn:
    'A detail the business did not give has no row at all: drop the typed stand-ins ("Call for today\'s hours", "In your neighbourhood", b.hours || "…", b.hours ? … : "…") and guard the row instead (b.hours && …), or draw the rows from b.facts.',
  quotes: 'Do not type client quotes, names or star ratings: what clients say comes only from <Testimonials>, so a reviews section shows real reviews or nothing.',
  anchor: 'Link only to the page\'s own sections: #top, #about, #services, #work, #reviews, #faq or #contact.',
  navMenu:
    'On phones and tablets <NavLinks> is a menu button (below lg, or the width its from= gives), and this header leaves it centred or alone on a row. It belongs at the left or right edge of the logo row: for links on a centred row of their own, pass mobile="scroll" (that row then keeps its links, scrolling on phones), or keep <NavLinks> at an edge of the logo row until the links move to their own row, with from set to that width (from="md" for a row that starts at md:).',
} as const

/** The ids a Showcase section may take, and so the only in-page links its header and buttons may use. */
export const SHOWCASE_ANCHORS = new Set(['top', 'about', 'services', 'work', 'reviews', 'faq', 'contact'])
// Stand-ins for a missing detail, as models write them.
const STAND_IN = /\b(in your neighbou?rhood|(call|message|whatsapp|ask|ring) (us )?(for|about) (today['’]?s |our |the )?(hours|timings|timing|address|location)|address (available )?on request|hours (vary|on request)|coming soon|lorem ipsum|your (address|city|area) here)\b/i
const STARS = /★{3,}|\b[45](\.\d)?\s*(\/\s*5|stars?)\b/i
const QUOTE_KEYS = /^(quote|review|testimonial|rating|stars|said)$/i

const DATA_LISTS = new Set(['Products', 'Categories', 'Brands', 'Reviews', 'Offers', 'SubCategories', 'AllCategories', 'AllBrands', 'Services', 'Work', 'Testimonials', 'Stats'])
const LIMITS: Record<string, number> = { Reviews: 3, Offers: 3 }
// Lists whose items always draw a picture (a photo, else a designed fill), so an opening built on them has one.
const PICTURE_LISTS = new Set(['Categories', 'Products', 'SubCategories', 'AllCategories'])

/** A literal class string, or null when the value is built at render (a ternary, a template with data). */
const literalClass = (v: CodeValue | undefined): string | null => (!v ? '' : v.k === 'lit' && typeof v.v === 'string' ? v.v : null)

/** A data list's grid that goes wrong for some number of items (holes, spans past its columns, slivers). */
function gridNote(node: Extract<CodeNode, { t: 'cmp' }>): string | null {
  const props = node.props ?? {}
  const layout = lit(props.layout)
  if (!DATA_LISTS.has(node.name) || (layout != null && layout !== 'grid')) return null
  const box = literalClass(props.className)
  if (!box) return null
  // Each item: what the render function returns (a default tile has no classes of its own), with itemClassName added.
  const extra = literalClass(props.itemClassName)
  const root = node.render?.body
  const own = !root ? '' : root.t === 'el' || root.t === 'cmp' ? literalClass(root.props?.className) : null
  if (extra == null || own == null) return null
  const limit = lit(props.limit)
  const trouble = gridTrouble(splitClasses(box), splitClasses(`${own} ${extra}`), Math.min(typeof limit === 'number' ? limit : (LIMITS[node.name] ?? 8), 12))
  if (!trouble) return null
  const { n, check } = trouble
  const why = check.overflow ? 'spans more columns than it has' : check.holes ? `leaves ${check.holes} empty ${check.holes === 1 ? 'cell' : 'cells'}` : 'squeezes items into slivers'
  return `<${node.name}>'s grid ${why} with ${n} ${n === 1 ? 'item' : 'items'} on a ${check.width === PHONE_WIDTH ? 'phone' : 'desktop'}, and a store can have any number: use layout="mosaic" (a picture mosaic that fits any count) or a plain grid without spans.`
}

/** The same findings on a Showcase page, whose details come from its own parts (code/parts/showcase.tsx). */
const SHOWCASE_LINT: Partial<Record<string, string>> = {
  [LINT.image]: 'Every <Image> needs a src from data (s.image, w.image, t.avatar, b.logo). Where there is no picture, design with colour, type and icons instead of an empty <Image>.',
  [LINT.price]: 'Do not type prices: they come from <Services> (s.price).',
  [LINT.contact]: 'Do not type a phone number, email or WhatsApp link: use <Business>{b => …}</Business> (b.phoneUrl, b.whatsappUrl, b.emailUrl, b.phone, b.email).',
  [LINT.newsletter]: 'There is no mailing list: take enquiries with <LeadForm /> instead.',
}

/**
 * What a studio section gets wrong, as repair notes (none = fine), worded for its page: hard-coded store data, a home
 * opening (`first`, or the section holding the page's h1) without a picture that is always there, data grids that
 * break for some number of items, and layouts that squeeze them or strand the header's menu button (layoutNotes).
 */
export function studioLint(ast: unknown, page?: PageKey | null, opts: { first?: boolean } = {}): string[] {
  const found = new Set<string>()
  let h1 = false
  let picture = false
  let businessPicture = false
  const showcase = page === 'showcase'
  const walk = (n: unknown, depth = 0) => {
    if (!n || typeof n !== 'object' || depth > 200) return
    const node = n as CodeNode
    switch (node.t) {
      case 'cmp': {
        const props = node.props ?? {}
        if (node.name === 'HeroPicture' || (PICTURE_LISTS.has(node.name) && (!node.render || draws(node.render.body)))) picture = true
        if (node.name === 'BusinessPicture') businessPicture = true
        if (showcase && node.name === 'Link') anchorHref(lit(props.href))
        const grid = gridNote(node)
        if (grid) found.add(grid)
        for (const key of TAXONOMY_PROPS[node.name] ?? []) if (has(lit(props[key]))) found.add(LINT.taxonomy)
        const query = lit(props.query)
        if (node.name === 'Products' && query && typeof query === 'object' && !Array.isArray(query)) {
          const q = query as Record<string, unknown>
          if (has(q.category) || has(q.brand) || has(q.slugs)) found.add(LINT.taxonomy)
        }
        if (node.name === 'Image') {
          const src = props.src
          if (!src || (src.k === 'lit' && !has(src.v))) found.add(LINT.image)
        }
        for (const v of Object.values(props)) hrefs(lit(v))
        // A store's NewsletterForm signs shoppers up to its offer emails; a Showcase business has no list.
        if (node.name === 'NewsletterForm' && page === 'showcase') found.add(LINT.newsletter)
        node.children?.forEach(c => walk(c, depth + 1))
        if (node.render) walk(node.render.body, depth + 1)
        return
      }
      case 'el':
        if (node.tag === 'a') checkHref(lit(node.props?.href))
        if (node.tag === 'a' && showcase) anchorHref(lit(node.props?.href))
        if (showcase && (node.tag === 'blockquote' || node.tag === 'q') && typed(node.children)) found.add(LINT.quotes)
        if (node.tag === 'h1') h1 = true
        // A heading with no data in it reads the same on every category or brand page.
        if (node.tag === 'h1' && (page === 'category' || page === 'brand') && !JSON.stringify(node.children ?? []).includes('"k":"path"')) found.add(LINT.heading)
        node.children?.forEach(c => walk(c, depth + 1))
        return
      case 'text':
        checkText(node.value)
        return
      case 'frag':
        node.children?.forEach(c => walk(c, depth + 1))
        return
      case 'cond':
        walk(node.then, depth + 1)
        walk(node.else, depth + 1)
        return
      case 'each': {
        const items = lit(node.items)
        if (Array.isArray(items)) JSON.stringify(items).match(/"(?:[^"\\]|\\.)*"/g)?.forEach(s => checkText(s))
        if (showcase && Array.isArray(items) && items.some(x => x && typeof x === 'object' && Object.keys(x).some(k => QUOTE_KEYS.test(k)))) found.add(LINT.quotes)
        if (showcase && Array.isArray(items)) for (const x of items) if (x && typeof x === 'object') anchorHref((x as { href?: unknown }).href)
        walk(node.body, depth + 1)
        return
      }
    }
  }
  const typed = (list: unknown): boolean => Array.isArray(list) && list.length > 0 && list.every(c => c && typeof c === 'object' && ((c as CodeNode).t === 'text' || ((c as CodeNode).t === 'el' && typed((c as { children?: unknown }).children))))
  const anchorHref = (href: unknown) => {
    const m = typeof href === 'string' ? /^\/?#(.*)$/.exec(href) : null
    if (m && !SHOWCASE_ANCHORS.has(m[1])) found.add(LINT.anchor)
  }
  const hrefs = (v: unknown, depth = 0): void => {
    if (typeof v === 'string') return v.startsWith('/') || /^(tel|mailto):|^https:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(v) ? checkHref(v) : undefined
    if (v && typeof v === 'object' && depth < 6) for (const x of Array.isArray(v) ? v : Object.values(v)) hrefs(x, depth + 1)
  }
  const checkHref = (href: unknown) => {
    if (typeof href !== 'string') return
    if (taxonomyOf(href) || /^\/products\/[a-z0-9][a-z0-9-]*\/?$/i.test(href)) found.add(LINT.link)
    if (/^(tel|mailto):/i.test(href) || (page === 'showcase' && /^https:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(href))) found.add(LINT.contact)
  }
  const checkText = (text: unknown) => {
    if (typeof text !== 'string') return
    if (PRICE.test(text)) found.add(LINT.price)
    if (PHONE.test(text) || EMAIL.test(text)) found.add(LINT.contact)
    if (showcase && STAND_IN.test(text)) found.add(LINT.standIn)
    if (showcase && STARS.test(text)) found.add(LINT.quotes)
  }
  walk(ast)
  layoutNotes(ast, page, found)
  if (page === 'home' && (opts.first || h1) && !picture) found.add(LINT.hero)
  // A Showcase opens with its header (`first`); the opening is the section holding the page's h1.
  if (showcase && h1 && !opts.first && !businessPicture) found.add(LINT.showcaseHero)
  if (showcase && placeholderRows(ast).size) found.add(LINT.standIn)
  return page === 'showcase' ? [...found].map(m => SHOWCASE_LINT[m] ?? m) : [...found]
}

/** A render function's items draw a picture (an <Image> or the site's product card). */
function draws(n: unknown, depth = 0): boolean {
  if (!n || typeof n !== 'object' || depth > 200) return false
  const node = n as CodeNode
  switch (node.t) {
    case 'cmp':
      return node.name === 'Image' || node.name === 'ProductCard' || node.children?.some(c => draws(c, depth + 1)) || draws(node.render?.body, depth + 1)
    case 'el':
    case 'frag':
      return node.children?.some(c => draws(c, depth + 1)) ?? false
    case 'cond':
      return draws(node.then, depth + 1) || draws(node.else, depth + 1)
    case 'each':
      return draws(node.body, depth + 1)
    default:
      return false
  }
}

// ── Layout, worked out from literal classes at a few widths ─────────────────────────────────────────────────────────

const SCREEN: Record<string, number> = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 }

/** A class's screen range and utility (`md:col-span-3` → from 768, col-span-3); null under hover:, dark: and other states. */
function screenOf(token: string): { min: number; max: number; util: string } | null {
  const parts = token.split(/:(?![^[]*\])/)
  const util = parts.pop()!.replace(/^!/, '')
  let min = 0
  let max = Infinity
  for (const v of parts) {
    if (SCREEN[v]) min = Math.max(min, SCREEN[v])
    else if (v.startsWith('max-') && SCREEN[v.slice(4)]) max = Math.min(max, SCREEN[v.slice(4)])
    else return null
  }
  return { min, max, util }
}

/** What the winning class of one kind says at a width: a wider screen variant beats a narrower one, then the later class. */
function at<T>(classes: string[], width: number, read: (util: string) => T | undefined): T | undefined {
  let best: T | undefined
  let from = -1
  for (const c of classes) {
    const s = screenOf(c)
    if (!s || s.min > width || width >= s.max || s.min < from) continue
    const v = read(s.util)
    if (v !== undefined) {
      best = v
      from = s.min
    }
  }
  return best
}

const DISPLAY = /^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|table|flow-root|contents|hidden)$/
const display = (c: string[], w: number) => at(c, w, u => (DISPLAY.test(u) ? u : undefined)) ?? 'block'
const isGrid = (c: string[], w: number) => /grid$/.test(display(c, w))

/** Columns a grid-cols class makes: grid-cols-3, grid-cols-[auto_1fr_auto], grid-cols-[repeat(4,minmax(0,1fr))]. */
function tracks(u: string): number | undefined {
  const m = /^grid-cols-(?:(\d+)|\[(.+)\]|(none))$/.exec(u)
  if (!m) return undefined
  if (m[1] || m[3]) return m[3] ? 1 : Number(m[1])
  const rep = /^repeat\((\d+),/.exec(m[2])
  if (rep) return Number(rep[1])
  let depth = 0
  let n = 1
  for (const ch of m[2]) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === '_' && !depth) n++
  }
  return n
}
const colsAt = (c: string[], w: number) => (isGrid(c, w) ? (at(c, w, tracks) ?? 1) : 1)
const spanAt = (c: string[], w: number) => at(c, w, u => (u === 'col-span-full' ? Infinity : /^col-span-\d+$/.test(u) ? Number(u.slice(9)) : undefined)) ?? 1
/** The class of one family (`all`) that wins at a width is `pick`. */
const wins = (c: string[], w: number, all: RegExp, pick: RegExp) => pick.test(at(c, w, u => (all.test(u) ? u : undefined)) ?? '')

/** A box lays its children out one under another at a width: a block, a flex column or a one-column grid. */
function stacks(c: string[], w: number): boolean {
  const d = display(c, w)
  if (/flex$/.test(d)) return wins(c, w, /^flex-(row|col)(-reverse)?$/, /^flex-col/)
  if (/grid$/.test(d)) return colsAt(c, w) === 1 && !wins(c, w, /^grid-flow-/, /col/)
  return d === 'block' || d === 'flow-root'
}
const CENTRES = [/^justify-(?!items-|self-)(.+)$/, /^justify-items-(.+)$/, /^place-content-(.+)$/, /^place-items-(.+)$/]
const centres = (c: string[], w: number) => CENTRES.some(re => at(c, w, u => re.exec(u)?.[1]) === 'center')
const fills = (c: string[], w: number) =>
  wins(c, w, /^(flex-(1|auto|initial|none)|(flex-)?grow(-0)?)$/, /^(flex-1|(flex-)?grow)$/) || wins(c, w, /^w-/, /^w-full$/) || wins(c, w, /^basis-/, /^basis-full$/)

type Box = { cls: string[] | null; kids: number }
const NAV_FROM: Record<string, number> = { md: 768, lg: 1024, xl: 1280 }
const NAV_AT = [390, 700, 900, 1150]

/**
 * Below its `from` width NavLinks is a menu button: true when that button is left alone on a row (its row stacks, or
 * the box holding it spans every column or takes a whole wrapped line) or centred, at some width it shows.
 */
function navAlone(chain: Box[], from: number): boolean {
  // The boxes holding only the menu, then the first holding it among other things: its row.
  const shell: Box[] = []
  let row: Box | null = null
  for (let i = chain.length - 1; i >= 0 && !row; i--) {
    if (chain[i].kids > 1) row = chain[i]
    else shell.push(chain[i])
  }
  const r = row?.cls
  if (!r) return false
  // What the row places: the outermost shell (NavLinks' own className styles its list, not its button).
  const place = shell.length ? shell[shell.length - 1].cls : []
  for (const w of NAV_AT) {
    if (w >= from) break
    if (chain.some(b => b.cls && display(b.cls, w) === 'hidden')) continue
    const alone =
      stacks(r, w) ||
      (!!place && isGrid(r, w) && colsAt(r, w) > 1 && spanAt(place, w) >= colsAt(r, w)) ||
      (!!place && /flex$/.test(display(r, w)) && wins(r, w, /^flex-(wrap|wrap-reverse|nowrap)$/, /^flex-wrap/) && (wins(place, w, /^w-/, /^w-full$/) || wins(place, w, /^basis-/, /^basis-full$/)))
    if (alone || centres(r, w) || shell.some(b => b.cls && centres(b.cls, w) && fills(b.cls, w))) return true
  }
  return false
}

const SQUEEZE_AT = [390, 768, 1024, 1280, 1440]
const pageWidth = (w: number) => Math.min(w - 32, 1280)
const MAX_W: Record<string, number> = { xs: 320, sm: 384, md: 448, lg: 512, xl: 576, '2xl': 672, '3xl': 768, '4xl': 896, '5xl': 1024, '6xl': 1152, '7xl': 1280, prose: 600 }

/** The width a w-, basis- or max-w- class gives inside `base` px; undefined for auto, fit, 0 and other classes. */
function sized(u: string, prop: 'w' | 'basis' | 'max-w', base: number, w: number): number | undefined {
  if (!u.startsWith(`${prop}-`)) return undefined
  const v = u.slice(prop.length + 1)
  let m: RegExpExecArray | null
  if (v === 'full') return base
  if (v === 'screen') return w
  if ((m = /^(\d+)\/(\d+)$/.exec(v))) return (base * Number(m[1])) / Number(m[2])
  if ((m = /^\[(\d+(?:\.\d+)?)(%|px|rem)\]$/.exec(v))) return m[2] === '%' ? (base * Number(m[1])) / 100 : Number(m[1]) * (m[2] === 'rem' ? 16 : 1)
  if (prop === 'max-w') return MAX_W[v]
  return (m = /^(\d+(?:\.5)?)$/.exec(v)) && Number(m[1]) > 0 ? Number(m[1]) * 4 : undefined
}

/** A box's width at a page width: its share of the parent grid's columns, then its own basis-, w- and max-w-. */
function widthIn(cls: string[] | null, grid: string[] | null, w: number, px: number): number {
  let base = px
  if (grid && isGrid(grid, w)) {
    const cols = colsAt(grid, w)
    base = (px * Math.min(cls ? spanAt(cls, w) : 1, cols)) / cols
  }
  if (!cls) return base
  const own = at(cls, w, u => sized(u, 'basis', base, w)) ?? at(cls, w, u => sized(u, 'w', base, w)) ?? base
  return Math.min(own, at(cls, w, u => sized(u, 'max-w', base, w)) ?? Infinity)
}

// A rail's slide: kept from shrinking (or snapped to) at a share of the rail's width.
const SLIDE = /^(snap-(start|center|end)|shrink-0|flex-shrink-0|flex-none)$/
const SHARE = /^(min-w|w|basis)-(\d+\/\d+|\[\d+(\.\d+)?%\])$/
const utilOf = (c: string) => screenOf(c)?.util ?? ''
const slideOf = (cls: string[] | null) =>
  cls && cls.some(c => SLIDE.test(utilOf(c))) && cls.some(c => SHARE.test(utilOf(c))) ? `a rail's slide ("${cls.join(' ').slice(0, 80)}")` : null
const CAROUSEL_SLIDE = 'one <Carousel> slide (each child of <Carousel> is a slide, so the whole list is one)'

// Lists that draw cards, and the grids they draw without a className (ItemsLayout's fallbackGrid, RelatedProducts').
const CARD_LISTS = new Set([...DATA_LISTS, 'RelatedProducts', 'CartUpsell'])
const LIST_GRID: Record<string, string> = {
  Brands: 'grid grid-cols-3 md:grid-cols-6',
  Reviews: 'grid md:grid-cols-3',
  Offers: 'grid md:grid-cols-3',
  Testimonials: 'grid md:grid-cols-3',
  Services: 'grid sm:grid-cols-2 lg:grid-cols-3',
  Work: 'grid grid-cols-2 md:grid-cols-3',
  RelatedProducts: 'grid grid-cols-2 lg:grid-cols-4',
}
// A list's limit as written: limit={n}, or query={{ …, limit: n }} (literal or holding bound values).
const listLimit = (node: Extract<CodeNode, { t: 'cmp' }>): number | null => {
  const own = lit(node.props?.limit)
  if (typeof own === 'number') return own
  const q = node.props?.query
  const v = q?.k === 'lit' && q.v && typeof q.v === 'object' ? (q.v as Record<string, unknown>).limit : q?.k === 'obj' ? lit(q.v.limit) : undefined
  return typeof v === 'number' ? v : null
}
const listGrid = (node: Extract<CodeNode, { t: 'cmp' }>, cls: string[]): string[] | null => {
  const layout = lit(node.props?.layout)
  if (layout === 'carousel' || layout === 'list') return null
  if (cls.length && layout !== 'mosaic') return cls
  // <Products> draws a single product in one column (its fallbackGrid), so a one-product spotlight fits anywhere.
  if (node.name === 'Products' && listLimit(node) === 1) return null
  return splitClasses(LIST_GRID[node.name] ?? 'grid grid-cols-2 md:grid-cols-4')
}

type Room = { px: number[]; hidden: boolean[]; slide: string | null; grid: string[] | null }

// What makes an item a card (a button, a price, a title) rather than a thumbnail, which may be small.
const CARD_PARTS = new Set(['ProductCard', 'QuickAdd', 'PriceTag', 'WishlistToggle', 'RatingStars', 'AddToCart'])
function cardish(n: unknown, depth = 0): boolean {
  if (!n || typeof n !== 'object' || depth > 200) return false
  const node = n as CodeNode
  const any = (list: unknown) => Array.isArray(list) && list.some(c => cardish(c, depth + 1))
  if (node.t === 'cmp') return CARD_PARTS.has(node.name) || any(node.children) || cardish(node.render?.body, depth + 1)
  if (node.t === 'el') return /^h[1-6]$/.test(node.tag) || any(node.children)
  if (node.t === 'frag') return any(node.children)
  if (node.t === 'cond') return cardish(node.then, depth + 1) || cardish(node.else, depth + 1)
  return node.t === 'each' && cardish(node.body, depth + 1)
}

const squeezed = (name: string, cols: number, where: string) =>
  `<${name}> lays out ${cols} columns ${where}, so its cards shrink to slivers ("Add to cart" wraps word by word, names are cut).`

/** A card list of 2+ columns inside a rail's slide, or in a box so narrow its cards come out under 150px. */
function squeeze(node: Extract<CodeNode, { t: 'cmp' }>, cls: string[], room: Room): string | null {
  const grid = listGrid(node, cls)
  if (!grid || (node.render && !cardish(node.render.body))) return null
  const cols = SQUEEZE_AT.map((w, i) => (room.hidden[i] ? 0 : (checkGrid(grid, [], w)?.cols ?? 1)))
  const most = Math.max(...cols)
  if (room.slide && most >= 2)
    return `${squeezed(node.name, most, `inside ${room.slide}`)} Give each slide one card: make the list itself the rail (layout="carousel" where it has one, else a className like "grid grid-flow-col auto-cols-[80%] sm:auto-cols-[45%] overflow-x-auto snap-x [&>*]:snap-start") instead of slides around it, or drop the rail and lay the grid out at full width.`
  for (const [i, w] of SQUEEZE_AT.entries())
    if (cols[i] >= 2 && room.px[i] < pageWidth(w) * 0.55 && room.px[i] / cols[i] < 150)
      return `${squeezed(node.name, cols[i], `in a column about ${Math.round((room.px[i] / pageWidth(w)) * 100)}% of the page wide`)} Lay the grid out at full width, or give that column one card per row (grid-cols-1) or a rail of one card per slide.`
  return null
}

const kidsOf = (list: unknown): number =>
  Array.isArray(list)
    ? list.reduce((s: number, c: CodeNode | null) => s + (!c || typeof c !== 'object' ? 0 : c.t === 'text' ? (c.value?.trim() ? 1 : 0) : c.t === 'frag' ? kidsOf(c.children) : c.t === 'each' ? 2 : 1), 0)
    : 0

/** Layout findings: a header's menu button left centred or alone on a row, and card lists squeezed into slivers. */
function layoutNotes(ast: unknown, page: PageKey | null | undefined, found: Set<string>): void {
  const walk = (n: unknown, chain: Box[], room: Room, depth: number): void => {
    if (!n || typeof n !== 'object' || depth > 200) return
    const node = n as CodeNode
    if (node.t === 'frag') return node.children?.forEach(c => walk(c, chain, room, depth + 1))
    if (node.t === 'cond') return (walk(node.then, chain, room, depth + 1), walk(node.else, chain, room, depth + 1))
    if (node.t === 'each') return walk(node.body, chain, room, depth + 1)
    if (node.t !== 'el' && node.t !== 'cmp') return
    const lc = literalClass(node.props?.className)
    const cls = lc == null ? null : splitClasses(lc)
    const list = node.t === 'cmp' && CARD_LISTS.has(node.name) ? node : null
    const inner: Room = {
      px: SQUEEZE_AT.map((w, i) => widthIn(cls, room.grid, w, room.px[i])),
      hidden: SQUEEZE_AT.map((w, i) => room.hidden[i] || (!!cls && display(cls, w) === 'hidden')),
      // A <Carousel> holding only a list draws the list's own carousel (interpret.tsx), so that list is not one slide.
      slide: room.slide ?? slideOf(cls) ?? (node.t === 'cmp' && node.name === 'Carousel' && !carouselList(node) ? CAROUSEL_SLIDE : null),
      grid: list ? listGrid(list, cls ?? []) : cls,
    }
    if (node.t === 'cmp' && node.name === 'NavLinks' && page === 'header' && (lit(node.props?.mobile) ?? 'menu') === 'menu')
      if (navAlone(chain, NAV_FROM[String(lit(node.props?.from) ?? 'lg')] ?? 1024)) found.add(LINT.navMenu)
    if (list && cls) {
      const note = squeeze(list, cls, inner)
      if (note) found.add(note)
    }
    const next = [...chain, { cls, kids: kidsOf(node.children) + (node.t === 'cmp' && node.render ? 2 : 0) }]
    node.children?.forEach(c => walk(c, next, inner, depth + 1))
    if (node.t === 'cmp' && node.render) walk(node.render.body, next, inner, depth + 1)
  }
  walk(ast, [], { px: SQUEEZE_AT.map(pageWidth), hidden: SQUEEZE_AT.map(() => false), slide: null, grid: null }, 0)
}

const CARD_LINT = {
  link: "Open the product with one stretched link: <h3><Link href={p.url} className=\"… after:absolute after:inset-0 after:content-['']\">{p.name}</Link></h3>, with relative on the card's root.",
  add: 'Give the card its add-to-cart button: <QuickAdd product={p} className="…" />.',
  trapped: 'Keep <QuickAdd> and <WishlistToggle> out of every link: they sit above the stretched link on their own.',
} as const

/** What a site card needs to work wherever it is drawn (lib/site/card.ts): its link, its button, nothing trapped in a link. */
export function cardLint(ast: unknown): string[] {
  let link = false
  let add = false
  let trapped = false
  const productUrl = (v: CodeValue | undefined) => !!v && v.k === 'path' && v.root === CARD_PRODUCT && v.path.length === 1 && v.path[0] === 'url'
  const walk = (n: unknown, inLink: boolean, depth = 0) => {
    if (!n || typeof n !== 'object' || depth > 200) return
    const node = n as CodeNode
    switch (node.t) {
      case 'cmp': {
        const isLink = node.name === 'Link'
        if (isLink && productUrl(node.props?.href)) link = true
        if (node.name === 'QuickAdd') add = true
        if (inLink && (node.name === 'QuickAdd' || node.name === 'WishlistToggle')) trapped = true
        node.children?.forEach(c => walk(c, inLink || isLink, depth + 1))
        return
      }
      case 'el': {
        const isLink = node.tag === 'a'
        if (isLink && productUrl(node.props?.href)) link = true
        node.children?.forEach(c => walk(c, inLink || isLink, depth + 1))
        return
      }
      case 'frag':
        node.children?.forEach(c => walk(c, inLink, depth + 1))
        return
      case 'cond':
        walk(node.then, inLink, depth + 1)
        walk(node.else, inLink, depth + 1)
        return
      case 'each':
        walk(node.body, inLink, depth + 1)
        return
    }
  }
  walk(ast, false)
  return [...(link ? [] : [CARD_LINT.link]), ...(add ? [] : [CARD_LINT.add]), ...(trapped ? [CARD_LINT.trapped] : [])]
}
