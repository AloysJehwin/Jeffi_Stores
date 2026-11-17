import type { PageKey } from '@jeffi/site-blocks'
import { CARD_PRODUCT, type CodeNode, type CodeValue } from '../code/ast'
import { taxonomyOf } from '../code/allow'

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
} as const

/** The same findings on a Showcase page, whose details come from its own parts (code/parts/showcase.tsx). */
const SHOWCASE_LINT: Partial<Record<string, string>> = {
  [LINT.image]: 'Every <Image> needs a src from data (s.image, w.image, t.avatar, b.logo). Where there is no picture, design with colour, type and icons instead of an empty <Image>.',
  [LINT.price]: 'Do not type prices: they come from <Services> (s.price).',
  [LINT.contact]: 'Do not type a phone number, email or WhatsApp link: use <Business>{b => …}</Business> (b.phoneUrl, b.whatsappUrl, b.emailUrl, b.phone, b.email).',
  [LINT.newsletter]: 'There is no mailing list: take enquiries with <LeadForm /> instead.',
}

/** The hard-coding a studio section has, as repair notes (none = fine), worded for its page. */
export function studioLint(ast: unknown, page?: PageKey | null): string[] {
  const found = new Set<string>()
  const walk = (n: unknown, depth = 0) => {
    if (!n || typeof n !== 'object' || depth > 200) return
    const node = n as CodeNode
    switch (node.t) {
      case 'cmp': {
        const props = node.props ?? {}
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
        walk(node.body, depth + 1)
        return
      }
    }
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
  }
  walk(ast)
  return page === 'showcase' ? [...found].map(m => SHOWCASE_LINT[m] ?? m) : [...found]
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
