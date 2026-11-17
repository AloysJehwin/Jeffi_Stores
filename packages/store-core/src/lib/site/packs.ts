import { randomUUID } from 'crypto'
import { normalizeDoc, type Archetype, type PageDoc, type PageKey, type SiteAudience, type SiteSurface, type SiteTemplate, type TemplatePage, type ThemeTokens } from '@jeffi/site-blocks'
import { siteRegistry } from './blocks'
import { DEFAULT_FOOTER_COLUMNS, DEFAULT_NAV } from './chrome-types'

// Site packs: a whole site in one style. A theme, the home page for desktop and phones, About, Contact, the product
// page, cart, sign-in and sign-up, and the header, footer and announcement bar. Copy is a starting point in the
// style's voice; product, category and brand blocks fill from the store's own catalogue. The AI site agent starts
// from the closest pack.

type B = { type: string; props?: Record<string, unknown> }

function doc(list: B[]): PageDoc {
  const blocks = list.map(b => {
    const def = siteRegistry.get(b.type)
    if (!def) throw new Error(`Unknown block ${b.type} in a site pack`)
    return { id: randomUUID(), type: b.type, v: def.v, props: def.props.parse(b.props ?? {}) as Record<string, unknown> }
  })
  return normalizeDoc({ blocks: Object.fromEntries(blocks.map(b => [b.id, b])), order: blocks.map(b => b.id) })
}

const row = (title: string, source: string, layout: 'grid' | 'carousel', limit = 8, eyebrow?: string): B => ({
  type: 'product_row',
  props: { title, eyebrow: eyebrow ?? null, config: { source, limit, layout } },
})

// The phone version of a home page: product rows become swipeable and shorter.
const phone = (list: B[]): B[] =>
  list.map(b =>
    b.type === 'product_row'
      ? { ...b, props: { ...b.props, config: { ...(b.props?.config as object), layout: 'carousel', limit: Math.min(6, Number((b.props?.config as { limit?: number })?.limit ?? 6)) } } }
      : b
  )

interface PackSpec {
  id: string
  name: string
  description: string
  archetype: Archetype
  audience: SiteAudience
  theme: Partial<ThemeTokens>
  announcement: { text: string; tone: 'brand' | 'dark' | 'accent' }
  tagline: string
  home: B[]
  story: { heading: string; body: string; make: string; why: string }
  welcome: { signIn: [string, string]; signUp: [string, string] }
}

function build(p: PackSpec): SiteTemplate {
  const pages: TemplatePage[] = []
  const put = (page: PageKey, surface: SiteSurface, d: PageDoc) => pages.push({ audience: p.audience, surface, page, doc: d })
  put('home', 'web', doc(p.home))
  put('home', 'web_mobile', doc(phone(p.home)))
  if (p.audience === 'store') {
    put('about', 'web', doc([
      { type: 'image_banner', props: { heading: p.story.heading, subheading: p.tagline, height: 'short' } },
      { type: 'rich_text', props: { heading: 'Who we are', body: p.story.body, align: 'center' } },
      { type: 'image_text', props: { heading: 'How we make it', body: p.story.make, imageSide: 'left' } },
      { type: 'image_text', props: { heading: 'Why customers come back', body: p.story.why, imageSide: 'right' } },
      { type: 'testimonials', props: { title: 'What customers say' } },
    ]))
    put('contact', 'web', doc([
      { type: 'rich_text', props: { heading: 'We are here to help', body: 'Write to us, call, or visit. We reply within one working day.', align: 'center' } },
      { type: 'contact_details' },
      { type: 'faq' },
    ]))
    put('product', 'web', doc([{ type: 'product_main' }, { type: 'trust_strip' }, row('You may also like', 'best_sellers', 'carousel')]))
    put('cart', 'web', doc([{ type: 'cart_main' }, row('Add a little extra', 'on_sale', 'carousel')]))
    put('login', 'web', doc([{ type: 'login_main', props: { sideHeading: p.welcome.signIn[0], sideText: p.welcome.signIn[1] } }]))
    put('signup', 'web', doc([{ type: 'signup_main', props: { sideHeading: p.welcome.signUp[0], sideText: p.welcome.signUp[1] } }]))
    for (const s of ['web', 'web_mobile'] as const) {
      put('header', s, doc([{ type: 'nav_links', props: { links: DEFAULT_NAV } }]))
      put('footer', s, doc([...DEFAULT_FOOTER_COLUMNS.map(c => ({ type: 'footer_column', props: c })), { type: 'footer_note', props: { text: p.tagline } }]))
      put('announcement', s, doc([{ type: 'announcement', props: p.announcement }]))
    }
  } else {
    put('about', 'web', doc([
      { type: 'rich_text', props: { heading: p.story.heading, body: p.story.body, align: 'center' } },
      { type: 'image_text', props: { heading: 'Built for trade buyers', body: p.story.make, imageSide: 'left' } },
      { type: 'faq', props: { heading: 'Trade questions', items: [{ q: 'Do you offer credit terms?', a: 'Approved accounts can buy on credit; ask your account manager.' }, { q: 'Can I get GST invoices?', a: 'Every order carries a GST invoice with your GSTIN.' }] } },
    ]))
    put('support', 'web', doc([{ type: 'contact_details', props: { heading: 'Talk to your account team' } }, { type: 'faq' }]))
  }
  return { id: `pack:${p.id}`, name: p.name, description: p.description, kind: 'site', archetype: p.archetype, theme: p.theme, pages }
}

const SPECS: PackSpec[] = [
  {
    id: 'heritage-luxury', name: 'Heritage Luxury', archetype: 'heritage_luxury', audience: 'store',
    description: 'Deep maroon and antique gold, serif type, generous space and few, large blocks. For couture, handloom and fine craft.',
    theme: { primary: '#7a1f2b', accent: '#b8860b', neutral: '#1c1a17', fontDisplay: 'Cormorant Garamond', fontBody: 'Lora', radius: 'none', buttonStyle: 'outline', density: 'airy' },
    announcement: { text: 'Complimentary shipping across India', tone: 'dark' },
    tagline: 'Heirloom craft, made to be handed down.',
    home: [
      { type: 'hero' },
      { type: 'category_grid', props: { title: 'Shop by collection', eyebrow: 'The edit' } },
      row('New in the atelier', 'new_arrivals', 'grid', 8, 'Just arrived'),
      { type: 'about', props: { title: 'The house', eyebrow: 'Our story' } },
      { type: 'testimonials', props: { title: 'In their words' } },
    ],
    story: { heading: 'The house', body: 'Every piece begins with a weaver, a pattern and months of patient work. We keep those crafts alive.', make: 'Handwoven on traditional looms, finished by hand and checked thread by thread.', why: 'Pieces that last generations, and care that continues after the sale.' },
    welcome: { signIn: ['Welcome back', 'Your wishlist, orders and private previews are waiting.'], signUp: ['Join the house', 'Early access to new collections and private viewings.'] },
  },
  {
    id: 'warm-festive', name: 'Warm Festive', archetype: 'warm_festive', audience: 'store',
    description: 'Saffron and magenta, celebratory and generous: offers up top, a countdown and best sellers. For festive and gifting seasons.',
    theme: { primary: '#c2410c', accent: '#be185d', neutral: '#3b2314', fontDisplay: 'Playfair Display', fontBody: 'Poppins', radius: 'lg', buttonStyle: 'solid', density: 'comfortable' },
    announcement: { text: 'Festive offers live: extra 10% off on orders above ₹1,999', tone: 'brand' },
    tagline: 'Celebrate every occasion.',
    home: [
      { type: 'motion_hero' },
      { type: 'offer_slider' },
      { type: 'countdown_deal' },
      { type: 'category_grid', props: { title: 'Shop for the occasion', eyebrow: 'Festive edit' } },
      row('Festive best sellers', 'best_sellers', 'carousel'),
      { type: 'testimonials', props: { title: 'Loved by families' } },
      { type: 'trust_strip' },
    ],
    story: { heading: 'Made for celebrations', body: 'From weddings to festivals, we help families celebrate in style, with pieces chosen for every occasion.', make: 'Sourced from makers we know, quality-checked and packed with care.', why: 'Festive-ready delivery, easy returns and gifting help.' },
    welcome: { signIn: ['Welcome back', 'Your festive wishlist and orders are a tap away.'], signUp: ['Join the celebration', 'Festive offers, reminders and members-only deals.'] },
  },
  {
    id: 'craft-earthy', name: 'Craft Earthy', archetype: 'craft_earthy', audience: 'store',
    description: 'Terracotta and leaf green, calm and natural, with the maker story up front. For handmade, organic and sustainable stores.',
    theme: { primary: '#8b5e34', accent: '#4d7c0f', neutral: '#2f2a24', fontDisplay: 'Marcellus', fontBody: 'DM Sans', radius: 'md', buttonStyle: 'outline', density: 'airy' },
    announcement: { text: 'Plastic-free packaging on every order', tone: 'accent' },
    tagline: 'Made by hand, kind to the earth.',
    home: [
      { type: 'hero' },
      { type: 'about', props: { title: 'Rooted in craft', eyebrow: 'Our makers' } },
      { type: 'category_showcase', props: { title: 'Explore the range' } },
      row('Fresh from the workshop', 'new_arrivals', 'grid'),
      { type: 'why_us', props: { title: 'Why choose us' } },
      { type: 'testimonials', props: { title: 'From our community' } },
    ],
    story: { heading: 'Rooted in craft', body: 'We work directly with artisans and small farms, paying fairly and keeping old skills alive.', make: 'Natural materials, small batches and no shortcuts.', why: 'Honest products, slow-made, delivered in plastic-free packs.' },
    welcome: { signIn: ['Good to see you', 'Your orders and saved favourites are here.'], signUp: ['Join our community', 'Maker stories, new batches and member offers.'] },
  },
  {
    id: 'minimal-modern', name: 'Minimal Modern', archetype: 'minimal_modern', audience: 'store',
    description: 'Black, white and one blue accent, clean sans-serif and lots of space. Lets the products do the talking.',
    theme: { primary: '#111827', accent: '#2563eb', neutral: '#111827', fontDisplay: 'Space Grotesk', fontBody: 'Inter', radius: 'sm', buttonStyle: 'solid', density: 'airy' },
    announcement: { text: 'Free delivery on all orders', tone: 'dark' },
    tagline: 'Less, but better.',
    home: [
      { type: 'hero' },
      row('Featured', 'featured', 'grid', 8),
      { type: 'category_grid', props: { title: 'Categories' } },
      { type: 'about', props: { title: 'About us' } },
    ],
    story: { heading: 'About us', body: 'We make a small range of things, and make them well.', make: 'Designed simply, built to last, tested before it ships.', why: 'Fewer choices, better ones, and service that answers.' },
    welcome: { signIn: ['Sign in', 'Orders, saved items and faster checkout.'], signUp: ['Create an account', 'Checkout faster and track every order.'] },
  },
  {
    id: 'bold-playful', name: 'Bold Playful', archetype: 'bold_playful', audience: 'store',
    description: 'Hot pink and amber, chunky type, rounded everything, stories and swipeable rows. For youthful brands and gifting.',
    theme: { primary: '#db2777', accent: '#f59e0b', neutral: '#1e1b4b', fontDisplay: 'Archivo Black', fontBody: 'Poppins', radius: 'full', buttonStyle: 'pill', density: 'comfortable' },
    announcement: { text: 'New drop every Friday. Don’t miss out!', tone: 'brand' },
    tagline: 'Life’s too short for boring.',
    home: [
      { type: 'motion_hero' },
      { type: 'stories', props: { title: 'Fresh drops' } },
      { type: 'offer_slider' },
      row('Everyone’s buying', 'best_sellers', 'carousel'),
      { type: 'category_tabs', props: { title: 'Pick your vibe' } },
      { type: 'social_strip', props: { title: 'Tag us to be featured' } },
    ],
    story: { heading: 'Hi, we’re us', body: 'We started because shopping should be fun. Bright colours, good stuff, zero boring.', make: 'Designed in-house, made in small fun batches.', why: 'Drops every week, easy returns and a crew that answers fast.' },
    welcome: { signIn: ['Hey, you’re back!', 'Your wishlist missed you.'], signUp: ['Join the crew', 'First dibs on drops and secret deals.'] },
  },
  {
    id: 'bazaar-dense', name: 'Bazaar Dense', archetype: 'bazaar_dense', audience: 'store',
    description: 'Amber and green, compact and packed with deals, brands and categories. For large catalogues and value shoppers.',
    theme: { primary: '#f59e0b', accent: '#16a34a', neutral: '#1f2937', fontDisplay: 'Montserrat', fontBody: 'Inter', radius: 'md', buttonStyle: 'solid', density: 'compact' },
    announcement: { text: 'Mega deals today: up to 60% off', tone: 'accent' },
    tagline: 'Everything you need, for less.',
    home: [
      { type: 'offer_slider' },
      { type: 'trust_strip' },
      { type: 'category_grid', props: { title: 'Shop by category' } },
      { type: 'deal_of_the_day' },
      row('Top deals', 'on_sale', 'carousel'),
      { type: 'brand_carousel', props: { title: 'Top brands' } },
      row('Best sellers', 'best_sellers', 'grid'),
      { type: 'bundle_spotlight' },
      { type: 'featured_for_you' },
    ],
    story: { heading: 'About us', body: 'A huge range at fair prices, delivered fast across India.', make: 'Sourced from trusted brands and distributors only.', why: 'Low prices, genuine products and easy returns.' },
    welcome: { signIn: ['Welcome back', 'Your cart, orders and deals are waiting.'], signUp: ['Sign up and save', 'Extra deals and faster checkout for members.'] },
  },
  {
    id: 'tech-mono', name: 'Tech Mono', archetype: 'tech_mono', audience: 'store',
    description: 'Slate and electric green, geometric type and a spotlight product. For electronics, gadgets and tools.',
    theme: { primary: '#0f172a', accent: '#22c55e', neutral: '#0f172a', fontDisplay: 'Space Grotesk', fontBody: 'Manrope', radius: 'sm', buttonStyle: 'outline', density: 'comfortable' },
    announcement: { text: 'Free 1-year warranty on every device', tone: 'dark' },
    tagline: 'Engineered to perform.',
    home: [
      { type: 'hero' },
      { type: 'product_spotlight' },
      row('New releases', 'new_arrivals', 'grid'),
      { type: 'value_stats' },
      { type: 'why_us', props: { title: 'Built different' } },
      { type: 'testimonials', props: { title: 'Trusted by pros' } },
    ],
    story: { heading: 'About us', body: 'We test every product we sell, so you get gear that works the first time.', make: 'Bench-tested, spec-checked and backed by warranty.', why: 'Expert advice, fast shipping and support that knows the product.' },
    welcome: { signIn: ['Sign in', 'Orders, warranties and saved gear.'], signUp: ['Create your account', 'Warranty tracking, faster checkout and early launches.'] },
  },
  {
    id: 'b2b-pro', name: 'B2B Pro', archetype: 'b2b_pro', audience: 'business',
    description: 'Navy and teal, compact and functional: reorder, quotes, trade offers and account details first. For the business portal.',
    theme: { primary: '#1e3a8a', accent: '#0891b2', neutral: '#0f172a', fontDisplay: 'Manrope', fontBody: 'Inter', radius: 'md', buttonStyle: 'solid', density: 'compact' },
    announcement: { text: 'Trade prices for approved business accounts', tone: 'dark' },
    tagline: 'Supply you can count on.',
    home: [
      { type: 'business_account' },
      { type: 'business_reorder' },
      { type: 'business_quotes' },
      { type: 'business_offers' },
      row('Popular with trade buyers', 'best_sellers', 'grid'),
      { type: 'benefits' },
    ],
    story: { heading: 'Your trade partner', body: 'We supply businesses across India with dependable stock, trade pricing and account support.', make: 'Bulk pricing, GST invoices, credit terms and quotes within a day.', why: '' },
    welcome: { signIn: ['', ''], signUp: ['', ''] },
  },
]

let cache: SiteTemplate[] | null = null
/** The built-in site packs (built once per process). */
export function sitePacks(): SiteTemplate[] {
  cache ??= SPECS.map(build)
  return cache
}

/** The pack builders, for pages assembled elsewhere (a home page laid out from a reference site). */
export { doc as packDoc, row as packRow, phone as phoneVersion, type B as PackBlock }
