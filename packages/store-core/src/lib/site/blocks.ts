import { z } from 'zod'
import { createRegistry, defineBlock, type BlockCategory, type PageKey, type SiteSurface } from '@jeffi/site-blocks'
import { HOMEPAGE_PAGES, SECTION_META, SECTION_TYPES, type SectionType } from '@/lib/catalog/homepage-sections'
import { DEFAULT_FOOTER_COLUMNS, DEFAULT_NAV } from './chrome-types'
import { cleanTree } from './composed'
import { MAX_SOURCE_BYTES } from './code/allow'

// The homepage's 32 section types as Site Builder blocks. Their settings keep the section shape (copy fields plus
// `config`) so the existing section components render them unchanged; typed per-block fields replace `config` as each
// block gets its own form (Phase 2).

const text = (max: number) => z.string().max(max).nullable().default(null)

export const SectionBlockProps = z.object({
  title: text(300),
  subtitle: text(1000),
  eyebrow: text(200),
  ctaLabel: text(100),
  ctaUrl: text(2000),
  config: z.record(z.string(), z.unknown()).default({}),
  /** Hero only: the slides it shows on this layout. */
  slides: z.array(z.record(z.string(), z.unknown())).optional(),
})
export type SectionBlockProps = z.infer<typeof SectionBlockProps>

const COMMERCE = new Set<SectionType>([
  'product_row', 'category_grid', 'brand_carousel', 'category_showcase', 'deal_of_the_day', 'featured_for_you',
  'countdown_deal', 'recently_viewed', 'category_tabs', 'bundle_spotlight', 'back_in_stock', 'product_spotlight', 'offer_slider',
])
const INTERACTIVE = new Set<SectionType>(['motion_hero', 'stories', 'rewards_game', 'slides'])

const category = (t: SectionType): BlockCategory =>
  t.startsWith('business_') ? 'business' : COMMERCE.has(t) ? 'commerce' : INTERACTIVE.has(t) ? 'interactive' : 'content'

// Section surfaces name the website once ('web' covers phone browsers too).
const surfacesOf = (t: SectionType): SiteSurface[] | undefined => {
  const s = SECTION_META[t].surfaces
  if (!s) return undefined
  return [...(s.includes('web') ? (['web', 'web_mobile'] as const) : []), ...(s.includes('app') ? (['app'] as const) : [])]
}

export const SECTION_BLOCKS = SECTION_TYPES.map(t => {
  const meta = SECTION_META[t]
  return defineBlock<SectionBlockProps>({
    type: t,
    v: 1,
    label: meta.label,
    description: meta.description,
    category: category(t),
    props: SectionBlockProps as unknown as z.ZodType<SectionBlockProps>,
    // Sections go on the homepage, listing and content pages, never in the site-wide header or footer.
    pages: (meta.pages ?? [...HOMEPAGE_PAGES, 'about', 'contact', 'support', 'returns', 'custom', 'product', 'cart', 'checkout', 'login', 'signup', 'account', 'legal', 'search', 'track', 'catalog', 'quotes', 'orders']) as PageKey[],
    audiences: meta.audiences,
    surfaces: surfacesOf(t),
    singleton: meta.singleton,
    plan: meta.plan,
    fields: {
      title: { kind: 'text', label: 'Heading', aiHint: 'Short heading in the store voice' },
      subtitle: { kind: 'text', label: 'Subheading' },
      eyebrow: { kind: 'text', label: 'Eyebrow', aiHint: 'Two or three words above the heading' },
      ctaLabel: { kind: 'text', label: 'Button label' },
      ctaUrl: { kind: 'link', label: 'Button link' },
      config: { kind: 'json', label: 'Settings' },
    },
  })
})

// ── Site-wide parts: the header's links, footer columns and the announcement bar ──────────────────

const Link = z.object({ label: z.string().trim().min(1).max(60), href: z.string().trim().min(1).max(500) })
const Links = { kind: 'list' as const, label: 'Links', aiHint: 'Short labels; site paths like /products or full URLs' }

export const NavLinksProps = z.object({ links: z.array(Link).max(10).default(DEFAULT_NAV) })
export const FooterColumnProps = z.object({ title: z.string().trim().max(60).default('Links'), links: z.array(Link).max(12).default([]) })
export const FooterNoteProps = z.object({ text: z.string().max(300).default('') })
export const AnnouncementProps = z.object({
  text: z.string().trim().min(1).max(160).default('Free delivery on your first order'),
  href: z.string().trim().max(500).nullable().default(null),
  tone: z.enum(['brand', 'dark', 'accent']).default('dark'),
})

export const CHROME_BLOCKS = [
  defineBlock<z.infer<typeof NavLinksProps>>({
    type: 'nav_links', v: 1, label: 'Menu links', category: 'page', singleton: true, pages: ['header'],
    description: 'The links in the header (the first three always show; more appear on wide screens) and the phone menu.',
    props: NavLinksProps as unknown as z.ZodType<z.infer<typeof NavLinksProps>>, fields: { links: Links },
  }),
  defineBlock<z.infer<typeof FooterColumnProps>>({
    type: 'footer_column', v: 1, label: 'Footer column', category: 'page', pages: ['footer'],
    description: 'A titled column of links in the footer.',
    props: FooterColumnProps as unknown as z.ZodType<z.infer<typeof FooterColumnProps>>,
    fields: { title: { kind: 'text', label: 'Column title' }, links: Links },
    presets: DEFAULT_FOOTER_COLUMNS.map(c => ({ label: c.title, props: c })),
  }),
  defineBlock<z.infer<typeof FooterNoteProps>>({
    type: 'footer_note', v: 1, label: 'Footer note', category: 'page', singleton: true, pages: ['footer'],
    description: 'Replaces the copyright line at the bottom of the footer.',
    props: FooterNoteProps as unknown as z.ZodType<z.infer<typeof FooterNoteProps>>, fields: { text: { kind: 'text', label: 'Note' } },
  }),
  defineBlock<z.infer<typeof AnnouncementProps>>({
    type: 'announcement', v: 1, label: 'Announcement', category: 'page', pages: ['announcement'],
    description: 'A slim bar under the header on every page. Several take turns.',
    props: AnnouncementProps as unknown as z.ZodType<z.infer<typeof AnnouncementProps>>,
    fields: {
      text: { kind: 'text', label: 'Message', aiHint: 'Under 80 characters: an offer, delivery promise or news' },
      href: { kind: 'link', label: 'Link (optional)' },
      tone: { kind: 'select', label: 'Colour', options: [{ value: 'dark', label: 'Dark' }, { value: 'brand', label: 'Brand colour' }, { value: 'accent', label: 'Accent colour' }] },
    },
  }),
]

export const isSectionBlock = (type: string) => (SECTION_TYPES as string[]).includes(type)
/** Site Builder content blocks the store renders with ContentBlock. */
export const isContentBlock = (type: string) => ['rich_text', 'image_text', 'image_banner', 'faq', 'contact_details', 'code_section'].includes(type)


// ── Content blocks: the building pieces of About, Contact, Support, Returns and custom pages ──────

export const CONTENT_PAGES: PageKey[] = ['home', 'about', 'contact', 'support', 'returns', 'custom', 'product', 'cart', 'checkout', 'login', 'signup', 'account', 'products', 'category', 'brand', 'legal', 'search', 'track', 'catalog', 'quotes', 'orders', 'wishlist', 'compare', 'not_found']
const longText = (max: number, d = '') => z.string().max(max).default(d)
const optText = (max: number) => z.string().max(max).nullable().default(null)

export const RichTextProps = z.object({
  heading: optText(200),
  body: longText(8000, 'Tell your story here: who you are, what you make and why customers trust you.'),
  align: z.enum(['left', 'center']).default('left'),
  width: z.enum(['narrow', 'wide']).default('narrow'),
})
export const ImageTextProps = z.object({
  image: optText(2000),
  heading: optText(200),
  body: longText(4000, 'A few lines about this part of your story.'),
  ctaLabel: optText(60),
  ctaUrl: optText(500),
  imageSide: z.enum(['left', 'right']).default('left'),
  aspect: z.enum(['1:1', '4:5', '4:3', '16:9']).default('4:5'),
})
export const ImageBannerProps = z.object({
  image: optText(2000),
  mobileImage: optText(2000),
  heading: optText(200),
  subheading: optText(400),
  ctaLabel: optText(60),
  ctaUrl: optText(500),
  height: z.enum(['short', 'medium', 'tall']).default('medium'),
  overlay: z.enum(['none', 'dark', 'light']).default('dark'),
  align: z.enum(['left', 'center']).default('center'),
})
export const FaqProps = z.object({
  heading: optText(200).default('Frequently asked questions'),
  items: z
    .array(z.object({ q: z.string().trim().min(1).max(300), a: z.string().max(3000) }))
    .max(40)
    .default([{ q: 'How long does delivery take?', a: 'Most orders arrive in 3 to 7 working days.' }]),
})
export const ContactDetailsProps = z.object({
  heading: optText(200).default('Get in touch'),
  note: optText(1000),
  showEmail: z.boolean().default(true),
  showPhone: z.boolean().default(true),
  showAddress: z.boolean().default(true),
  showHours: z.boolean().default(true),
})

const cast = <T,>(s: z.ZodTypeAny) => s as unknown as z.ZodType<T>
// A block the AI composed from safe primitives (lib/site/composed.ts); the tree is cleaned, never trusted.
export const ComposedProps = z.object({
  label: z.string().trim().max(80).default('Custom block'),
  tree: z.unknown().transform(t => cleanTree(t).tree),
})
const ALIGN = [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }]

export const CONTENT_BLOCKS = [
  defineBlock<z.infer<typeof RichTextProps>>({
    type: 'rich_text', v: 1, label: 'Text', category: 'content', pages: CONTENT_PAGES,
    description: 'A heading and paragraphs. Leave an empty line between paragraphs.',
    props: cast(RichTextProps),
    fields: {
      heading: { kind: 'text', label: 'Heading' },
      body: { kind: 'richtext', label: 'Text', aiHint: 'Two to four short paragraphs in the store voice' },
      align: { kind: 'select', label: 'Alignment', options: ALIGN },
      width: { kind: 'select', label: 'Width', options: [{ value: 'narrow', label: 'Narrow (easy to read)' }, { value: 'wide', label: 'Wide' }] },
    },
  }),
  defineBlock<z.infer<typeof ImageTextProps>>({
    type: 'image_text', v: 1, label: 'Image with text', category: 'content', pages: CONTENT_PAGES,
    description: 'A picture beside a heading, text and an optional button. Stacks on phones.',
    props: cast(ImageTextProps),
    aspectSlots: [{ key: 'image', label: 'Image', aspect: { web: '4:5', web_mobile: '4:5' } }],
    fields: {
      image: { kind: 'image', label: 'Image', size: 'portrait' },
      heading: { kind: 'text', label: 'Heading' },
      body: { kind: 'richtext', label: 'Text' },
      ctaLabel: { kind: 'text', label: 'Button label' },
      ctaUrl: { kind: 'link', label: 'Button link' },
      imageSide: { kind: 'select', label: 'Image side', options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] },
      aspect: { kind: 'select', label: 'Image shape', options: ['1:1', '4:5', '4:3', '16:9'].map(v => ({ value: v, label: v })) },
    },
  }),
  defineBlock<z.infer<typeof ImageBannerProps>>({
    type: 'image_banner', v: 1, label: 'Image banner', category: 'content', pages: CONTENT_PAGES,
    description: 'A full-width picture with an optional heading and button; a separate picture for phones if you like.',
    props: cast(ImageBannerProps),
    aspectSlots: [{ key: 'image', label: 'Banner', aspect: { web: '21:9', web_mobile: '4:5' } }],
    fields: {
      image: { kind: 'image', label: 'Image', size: 'hero' },
      mobileImage: { kind: 'image', label: 'Phone image (optional)', size: 'portrait' },
      heading: { kind: 'text', label: 'Heading' },
      subheading: { kind: 'text', label: 'Subheading' },
      ctaLabel: { kind: 'text', label: 'Button label' },
      ctaUrl: { kind: 'link', label: 'Button link' },
      height: { kind: 'select', label: 'Height', options: [{ value: 'short', label: 'Short' }, { value: 'medium', label: 'Medium' }, { value: 'tall', label: 'Tall' }] },
      overlay: { kind: 'select', label: 'Text contrast', options: [{ value: 'dark', label: 'Darken the image' }, { value: 'light', label: 'Lighten the image' }, { value: 'none', label: 'None' }] },
      align: { kind: 'select', label: 'Text alignment', options: ALIGN },
    },
  }),
  defineBlock<z.infer<typeof FaqProps>>({
    type: 'faq', v: 1, label: 'Questions and answers', category: 'content', pages: CONTENT_PAGES,
    description: 'Questions that open to show their answers.',
    props: cast(FaqProps),
    fields: {
      heading: { kind: 'text', label: 'Heading' },
      items: { kind: 'list', label: 'Questions', item: [{ key: 'q', label: 'Question', kind: 'text' }, { key: 'a', label: 'Answer', kind: 'richtext' }] },
    },
  }),
  defineBlock<z.infer<typeof ComposedProps>>({
    type: 'composed', v: 1, label: 'Custom block', category: 'content', pages: CONTENT_PAGES,
    description: 'A block the AI built for you from your products, categories, reviews and offers. Ask the AI to change it.',
    props: cast(ComposedProps),
    fields: { label: { kind: 'text', label: 'Name (only you see it)' } },
  }),
  defineBlock<z.infer<typeof ContactDetailsProps>>({
    type: 'contact_details', v: 1, label: 'Contact details', category: 'content', pages: CONTENT_PAGES,
    description: 'Your email, phone, address and opening hours from Site Controls, so they stay in one place.',
    props: cast(ContactDetailsProps),
    fields: {
      heading: { kind: 'text', label: 'Heading' },
      note: { kind: 'richtext', label: 'Note (optional)' },
      showEmail: { kind: 'boolean', label: 'Show email' },
      showPhone: { kind: 'boolean', label: 'Show phone' },
      showAddress: { kind: 'boolean', label: 'Show address' },
      showHours: { kind: 'boolean', label: 'Show opening hours' },
    },
  }),
]

// ── Page-core blocks: the working part of a store page, kept on the page (move it, add blocks around it) ──

const Empty = z.object({})
// Sign-in and sign-up can sit beside a picture panel (stacked under it on phones).
export const AuthCoreProps = z.object({
  sideImage: z.string().max(2000).nullable().default(null),
  sideHeading: z.string().max(160).nullable().default(null),
  sideText: z.string().max(600).nullable().default(null),
  sidePosition: z.enum(['left', 'right']).default('left'),
})
const AUTH_FIELDS = {
  sideImage: { kind: 'image' as const, label: 'Side picture (optional)', size: 'portrait' as const },
  sideHeading: { kind: 'text' as const, label: 'Side heading', aiHint: 'A short welcome or reason to join' },
  sideText: { kind: 'richtext' as const, label: 'Side text' },
  sidePosition: { kind: 'select' as const, label: 'Picture side', options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] },
}
export const CORE_BLOCKS = [
  defineBlock<Record<string, never>>({
    type: 'product_main', v: 1, label: 'Product details', category: 'page', singleton: true, locked: true, pages: ['product'],
    description: "The product's photos, price, options, add to cart, specifications, reviews and related products. It stays on the page; add blocks above or below it.",
    props: cast(Empty),
  }),
  defineBlock<z.infer<typeof AuthCoreProps>>({
    type: 'login_main', v: 1, label: 'Sign-in form', category: 'page', singleton: true, locked: true, pages: ['login'],
    description: 'The sign-in form (email, phone, Google). Add a side picture with a welcome, or blocks above and below.',
    props: cast(AuthCoreProps), fields: AUTH_FIELDS,
  }),
  defineBlock<z.infer<typeof AuthCoreProps>>({
    type: 'signup_main', v: 1, label: 'Sign-up form', category: 'page', singleton: true, locked: true, pages: ['signup'],
    description: 'The account sign-up form. Add a side picture with the reasons to join, or blocks above and below.',
    props: cast(AuthCoreProps), fields: AUTH_FIELDS,
  }),
  defineBlock<Record<string, never>>({
    type: 'account_main', v: 1, label: 'Account overview', category: 'page', singleton: true, locked: true, pages: ['account'],
    description: "The customer's account home: orders, rewards, addresses and profile. Add blocks above or below it.",
    props: cast(Empty),
  }),
  defineBlock<Record<string, never>>({
    type: 'listing_main', v: 1, label: 'Products', category: 'page', singleton: true, locked: true, pages: ['products', 'category', 'brand'],
    slots: ['between'],
    description: 'The filters and product grid. Sections inside it show between the products; blocks before or after it show above or below the grid.',
    props: cast(Empty),
  }),
  defineBlock<Record<string, never>>({
    type: 'cart_main', v: 1, label: 'Cart', category: 'page', singleton: true, locked: true, pages: ['cart'],
    description: 'The cart itself: items, coupons, totals and checkout. It stays on the page; add blocks above or below it.',
    props: cast(Empty),
  }),
  defineBlock<Record<string, never>>({
    type: 'checkout_main', v: 1, label: 'Checkout', category: 'page', singleton: true, locked: true, pages: ['checkout'],
    description: 'The checkout: address, delivery, payment and the order summary. The payment flow never changes; add blocks above or below it.',
    props: cast(Empty),
  }),
  defineBlock<Record<string, never>>({
    type: 'legal_main', v: 1, label: 'Policy text', category: 'page', singleton: true, locked: true, pages: ['legal'],
    description: 'The list of policies on /legal, and each policy with its sections and PDF download. Add blocks above or below it.',
    props: cast(Empty),
  }),
  defineBlock<Record<string, never>>({
    type: 'search_main', v: 1, label: 'Search results', category: 'page', singleton: true, locked: true, pages: ['search'],
    description: 'The filters and the products matching the search. Add blocks above or below it.',
    props: cast(Empty),
  }),
  defineBlock<Record<string, never>>({
    type: 'track_main', v: 1, label: 'Order tracking', category: 'page', singleton: true, locked: true, pages: ['track'],
    description: "The customer's order: its items, status, tracking and actions. Add blocks above or below it.",
    props: cast(Empty),
  }),
  defineBlock<Record<string, never>>({
    type: 'catalog_main', v: 1, label: 'Trade catalogue', category: 'page', singleton: true, locked: true, pages: ['catalog'], audiences: ['business'],
    description: 'The business catalogue with negotiated prices. Add blocks above or below it.',
    props: cast(Empty),
  }),
  defineBlock<Record<string, never>>({
    type: 'quotes_main', v: 1, label: 'Quotes', category: 'page', singleton: true, locked: true, pages: ['quotes'], audiences: ['business'],
    description: "The business customer's quote requests and quotations. Add blocks above or below it.",
    props: cast(Empty),
  }),
  defineBlock<Record<string, never>>({
    type: 'orders_main', v: 1, label: 'Orders', category: 'page', singleton: true, locked: true, pages: ['orders'], audiences: ['business'],
    description: "The business customer's orders. Add blocks above or below it.",
    props: cast(Empty),
  }),
  defineBlock<Record<string, never>>({
    type: 'categories_main', v: 1, label: 'All categories', category: 'page', singleton: true, locked: true, pages: ['categories'],
    description: 'Every category with its subcategories and product counts. Add blocks above or below it.',
    props: cast(Empty),
  }),
  defineBlock<Record<string, never>>({
    type: 'brands_main', v: 1, label: 'All brands', category: 'page', singleton: true, locked: true, pages: ['brands'],
    description: 'Every brand with its logo and product count. Add blocks above or below it.',
    props: cast(Empty),
  }),
  defineBlock<Record<string, never>>({
    type: 'wishlist_main', v: 1, label: 'Wishlist', category: 'page', singleton: true, locked: true, pages: ['wishlist'], audiences: ['store'],
    description: "The shopper's saved products with move to cart and remove. Add blocks above or below it.",
    props: cast(Empty),
  }),
  defineBlock<Record<string, never>>({
    type: 'compare_main', v: 1, label: 'Compare', category: 'page', singleton: true, locked: true, pages: ['compare'], audiences: ['store'],
    description: 'The products being compared side by side. Add blocks above or below it.',
    props: cast(Empty),
  }),
  defineBlock<Record<string, never>>({
    type: 'not_found_main', v: 1, label: 'Page not found', category: 'page', singleton: true, locked: true, pages: ['not_found'], audiences: ['store'],
    description: 'The not-found message with a search box and popular links. Add blocks above or below it.',
    props: cast(Empty),
  }),
]

// ── Code sections: a section the AI wrote as TSX (lib/site/code), recompiled on every save, interpreted on render ──

/** The engaging pages (docs/AI_SITE_STUDIO_PLAN.md section 2), store and business, and the site's product card. */
export const CODE_SECTION_PAGES: PageKey[] = ['home', 'products', 'category', 'brand', 'search', 'product', 'cart', 'checkout', 'header', 'footer', 'announcement', 'about', 'contact', 'catalog', 'quotes', 'card', 'categories', 'brands', 'showcase',
  // The working pages (studio/utility.ts), each designed around its core part (code/parts/utility.tsx).
  'login', 'signup', 'account', 'track', 'wishlist', 'compare', 'legal', 'returns', 'support', 'not_found']
const DEFAULT_CODE = `export default function Section() {
  return (
    <section className="container mx-auto px-4 py-12 text-center">
      <h2 className="font-display text-3xl text-foreground">A new section</h2>
      <p className="mt-2 text-foreground-secondary">Ask the AI to write this section.</p>
    </section>
  )
}
`
export const CodeSectionProps = z.object({
  label: z.string().trim().max(80).default('Section'),
  source: z.string().max(MAX_SOURCE_BYTES).default(DEFAULT_CODE),
  /** Built from `source` by recompileCodeSections on save; never trusted from a client. */
  compiled: z.unknown().nullable().default(null),
})
export const CODE_BLOCKS = [
  defineBlock<z.infer<typeof CodeSectionProps>>({
    type: 'code_section', v: 1, label: 'Code section', category: 'content', pages: CODE_SECTION_PAGES, surfaces: ['web', 'web_mobile'],
    description: 'A section the AI wrote as code, wired to your products. Ask the AI to change it.',
    props: cast(CodeSectionProps),
    fields: { label: { kind: 'text', label: 'Name (only you see it)' } },
  }),
]

/** The core block a page must keep, if it has one. */
export const coreBlockFor = (page: PageKey) => CORE_BLOCKS.find(d => d.pages?.includes(page)) ?? null

export const siteRegistry = createRegistry([...SECTION_BLOCKS, ...CHROME_BLOCKS, ...CONTENT_BLOCKS, ...CORE_BLOCKS, ...CODE_BLOCKS])
