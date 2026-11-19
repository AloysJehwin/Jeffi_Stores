import type { PageKey, SiteAudience } from '@jeffi/site-blocks'
import { askJson, clip, listOf, orNull, pick, rng, shuffle, str, studioBudgetLeft } from './ai'
import { partsFor, requiredParts } from './library'
import type { PlannedPage, PlannedSection, StudioBrief, StudioPlan, ThemedPage } from './types'
import { SHOWCASE_PAGE_KEY } from '../../showcase/types'
import { UTILITY_SPECS } from './utility'

// The page plan (contract section 2): engaging pages get sections the AI designs, chosen for this brief; the rest take
// the theme. Variety: a content approach is picked per brief (the model chooses among seeded candidates), the model
// writes the sections, and every gap is filled from seeded pools, never from a fixed template.

interface PageSpec {
  page: PageKey
  label: string
  optional?: boolean
  alsoFor?: PageKey[]
  sections: [number, number]
  /** Parts the page needs to work (each goes to exactly one section). */
  must: string[]
  /** Section ideas: the menu the model may draw from, and the fallback. */
  pool: string[][]
  /** The parts each pool group's section uses when the plan falls back to the pool (by group). */
  parts?: string[][]
  /** Compositions that suit this page (functional pages and the chrome); the general list otherwise. */
  layouts?: string[]
  /** The compositions that suit each pool group's section (by group), where the page's list holds ones that suit only some. */
  groupLayouts?: string[][]
}

const STORE: PageSpec[] = [
  { page: 'announcement', label: 'Announcement bar', optional: true, sections: [1, 1], must: ['AnnouncementText'], pool: [['A slim bar with the store promise or an offer code; several messages take turns']], layouts: ['one centred line', 'a slow marquee of messages', 'a line with a short link at the end'] },
  { page: 'header', label: 'Header', sections: [1, 1], must: ['Logo', 'NavLinks', 'CartIcon', 'SearchBox', 'AccountLink'], pool: [['The site header: logo, menu, search, account and cart; on phones a compact bar']], layouts: ['logo left, menu centred, icons right', 'centred logo over the menu row', 'logo and a wide search on one row, the menu below', 'a slim bar with the menu tucked away on phones'] },
  {
    page: 'home',
    label: 'Home',
    sections: [5, 8],
    must: [],
    pool: [
      ['Full-bleed campaign hero: one bold line, two calls to action', 'Split hero: big headline beside a collage of product pictures', 'Typographic hero: oversized headline over a thin strip of new products', 'Hero carousel of three campaign slides', 'Hero that opens with the store promise and a single hero product'],
      ['Category tiles as a mosaic', 'Shop by category as a row of circles', 'Shop-by-occasion tabs, each with its products', 'Collections as tall image cards in a horizontal scroller'],
      ['New arrivals carousel', 'Best sellers as a bento grid with one large card', 'Tabs: new in / best sellers / on sale', 'One product in the spotlight with its story', 'Deal of the day with a countdown'],
      ['Brands as a logo marquee', 'A strip of promises: delivery, returns, secure payment', 'Why shop here: three reasons with icons'],
      ['The maker story: picture and words side by side', 'How it is made in three steps', 'What the store stands for as a values grid', 'A lookbook grid of looks'],
      ['A wall of customer reviews', 'A testimonial carousel with ratings'],
      ['A closing call to shop the collection', 'An offer banner for the live offers'],
    ],
    // The hero's picture is always there (an offer's, else a product's or category's photo, else a designed fill).
    parts: [['HeroPicture']],
  },
  {
    page: 'products',
    label: 'Product listing',
    sections: [1, 3],
    must: ['ProductResults'],
    pool: [['A short title band for the listing with the result count'], ['Filters and sort beside or above the product results'], ['Shop-by-category chips above the results', 'A promise strip under the results']],
    parts: [[], ['Filters', 'SortMenu', 'ProductResults']],
    groupLayouts: [['a band in the brand colour with light text', 'an oversized word or number as the graphic'], ['filters in a column on the left, the grid on the right'], ['horizontal scroller with the next card peeking', 'three equal columns with thin dividers', 'an edge-to-edge marquee strip']],
  },
  // Every category page wears this design, filled with its own category: never one category's name or picture. A plan
  // that falls back to the pool takes its first `sections[0]` groups, so those hold what the page needs.
  {
    page: 'category',
    label: 'Category pages',
    sections: [2, 4],
    must: ['Category', 'Breadcrumbs', 'SubCategories', 'ProductResults'],
    pool: [
      [
        'Category hero: breadcrumbs, the name from <Category> as the page heading, its tagline and description over or beside its hero picture, its subcategories from <SubCategories> as chips under it (they hide when there are none)',
        'Typographic category header: breadcrumbs, the name from <Category> set large with its product count, the description beside it, its subcategories from <SubCategories> as picture tiles below',
      ],
      ['Products and filters: filters and sort beside or above the product results', 'Products under a toolbar: the result count and sort over the results, the filters in a drawer'],
      ["Questions and more: the category's questions from <CategoryFaqs> beside its longer copy from <SeoText>, quiet and easy to read (each hides when empty)"],
    ],
    parts: [['Category', 'Breadcrumbs', 'SubCategories'], ['Filters', 'SortMenu', 'ProductResults'], ['CategoryFaqs', 'SeoText']],
    layouts: ['a full-width band with the words over the picture', 'two columns: words on one side, picture or list on the other', 'a slim band under a thin rule', 'filters in a column on the left, the grid on the right', 'a centred narrow column with generous space'],
    groupLayouts: [
      ['a full-width band with the words over the picture', 'two columns: words on one side, picture or list on the other', 'a slim band under a thin rule'],
      ['filters in a column on the left, the grid on the right'],
      ['two columns: words on one side, picture or list on the other', 'a centred narrow column with generous space', 'a slim band under a thin rule'],
    ],
  },
  {
    page: 'brand',
    label: 'Brand pages',
    optional: true,
    sections: [2, 3],
    must: ['Brand', 'Breadcrumbs', 'ProductResults'],
    pool: [
      [
        'Brand hero: breadcrumbs, its logo, the name from <Brand> as the page heading, tagline and description, on its banner picture when it has one',
        'Brand introduction: breadcrumbs, the logo and name from <Brand> beside its story, with its website and social links',
      ],
      ["Products and filters: filters and sort beside or above the brand's product results", "Products under a toolbar: the brand's products in a clean grid under the result count and sort"],
      ['Brand story: the story from <Brand> and its longer copy from <SeoText> in a quiet band (each hides when empty)'],
    ],
    parts: [['Brand', 'Breadcrumbs'], ['Filters', 'SortMenu', 'ProductResults'], ['SeoText']],
    layouts: ['a full-width band with the words over the banner', 'the logo and words in two columns', 'a slim band under a thin rule', 'filters in a column on the left, the grid on the right', 'a centred narrow column with generous space'],
    groupLayouts: [
      ['a full-width band with the words over the banner', 'the logo and words in two columns', 'a slim band under a thin rule'],
      ['filters in a column on the left, the grid on the right'],
      ['a centred narrow column with generous space', 'a slim band under a thin rule'],
    ],
  },
  {
    page: 'search',
    label: 'Search results',
    optional: true,
    sections: [1, 2],
    must: ['SearchQuery', 'ProductResults'],
    pool: [
      [
        'Search results: the term and the number of results from <SearchQuery> over the search box to search again, then the filters, sort and matching products',
        'Search band: the term and result count from <SearchQuery> and the search box in a slim band, the filters beside the matching products below',
      ],
      ["Other categories: the store's categories from <Categories> for shoppers who did not find what they wanted"],
    ],
    parts: [['SearchQuery', 'SearchBox', 'Filters', 'SortMenu', 'ProductResults'], ['Categories']],
    groupLayouts: [['filters in a column on the left, the grid on the right'], ['horizontal scroller with the next card peeking', 'bento grid with one large tile', 'a heading pinned beside a list']],
  },
  {
    page: 'product',
    label: 'Product page',
    sections: [2, 4],
    must: ['ProductGallery', 'ProductTitle', 'ProductPrice', 'VariantPicker', 'AddToCart'],
    pool: [['Gallery beside the buy box: title, rating, price, options, quantity, add to cart, buy now, delivery check'], ['Description and specifications in tabs or an accordion'], ['Customer reviews'], ['Related products in a carousel']],
    parts: [['ProductGallery', 'ProductTitle', 'ProductPrice', 'VariantPicker', 'AddToCart'], ['ProductDescription', 'ProductSpecs'], ['ProductReviews'], ['RelatedProducts']],
    layouts: ['gallery left, sticky buy box right', 'a large gallery on top, details in two columns below', 'a thumbnail rail, the big picture, then the buy box', 'a full-width band with a centred heading over a card grid'],
    groupLayouts: [
      ['gallery left, sticky buy box right', 'a large gallery on top, details in two columns below', 'a thumbnail rail, the big picture, then the buy box'],
      ['tabs over a centred readable column', 'a heading pinned beside the details'],
      ['the rating summary pinned beside the reviews', 'a centred readable column'],
      ['a full-width band with a centred heading over a card grid'],
    ],
  },
  {
    page: 'cart',
    label: 'Cart',
    sections: [1, 3],
    must: ['CartLines', 'CheckoutButton'],
    pool: [['Free shipping progress above the cart'], ['Cart lines beside the summary, coupon and checkout button'], ['Products to add before checkout']],
    parts: [['FreeShippingProgress'], ['CartLines', 'CartSummary', 'CouponBox', 'CheckoutButton'], ['CartUpsell']],
    layouts: ['lines left, a sticky summary right', 'one column with the summary card at the end', 'a slim full-width band', 'a horizontal scroller of cards'],
    groupLayouts: [['a slim full-width band'], ['lines left, a sticky summary right', 'one column with the summary card at the end'], ['a horizontal scroller of cards']],
  },
  {
    page: 'checkout',
    label: 'Checkout',
    sections: [1, 2],
    must: ['ContactForm', 'AddressForm', 'DeliveryOptions', 'PaymentStep', 'OrderSummary'],
    pool: [['Contact, address, delivery and the payment step beside the order summary'], ['Trust badges and help under the checkout']],
    parts: [['ContactForm', 'AddressForm', 'DeliveryOptions', 'PaymentStep', 'OrderSummary'], ['TrustBadges']],
    layouts: ['form steps left, a sticky order summary right', 'the summary first on phones, two columns on desktop', 'a quiet centred band with three columns'],
    groupLayouts: [['form steps left, a sticky order summary right', 'the summary first on phones, two columns on desktop'], ['a quiet centred band with three columns']],
  },
  { page: 'about', label: 'About', optional: true, sections: [3, 5], must: [], pool: [['An opening statement over a large picture', 'A typographic opening with the founding year'], ['The story in words and pictures', 'A timeline of milestones'], ['How the products are made', 'The people behind the store'], ['What customers say'], ['A call to shop the collection']] },
  { page: 'contact', label: 'Contact', optional: true, sections: [2, 3], must: [], pool: [['How to reach the store: phone, email, WhatsApp, address'], ['Questions shoppers ask, in an accordion'], ['A band inviting a visit or a call']] },
  {
    page: 'categories',
    label: 'All categories',
    optional: true,
    sections: [1, 2],
    must: ['AllCategories'],
    pool: [
      [
        'All categories: every category from <AllCategories> under a heading with breadcrumbs, as a visual grid of picture cards with their subcategories and product counts',
        'Category mosaic: every category from <AllCategories> as large picture tiles under a big heading with breadcrumbs, its subcategories listed under each',
      ],
      ['Browse everything: a closing band inviting shoppers to browse every product'],
    ],
    parts: [['Breadcrumbs', 'AllCategories'], []],
    layouts: ['a slim title band over a wide grid', 'a centred heading over a mosaic with one large tile', 'a heading pinned beside the list'],
    groupLayouts: [
      ['a slim title band over a wide grid', 'a centred heading over a mosaic with one large tile', 'a heading pinned beside the list'],
      ['a band in the brand colour with light text', 'a centered card floating over a tinted background'],
    ],
  },
  {
    page: 'brands',
    label: 'All brands',
    optional: true,
    sections: [1, 2],
    must: ['AllBrands'],
    pool: [
      [
        'All brands: every brand from <AllBrands> under a heading with breadcrumbs, as a grid of logo cards with taglines and product counts',
        'Brand wall: the featured brands from <AllBrands> large first, then every brand as a dense logo wall, under a heading with breadcrumbs',
      ],
      ['Browse everything: a closing band inviting shoppers to browse every product'],
    ],
    parts: [['Breadcrumbs', 'AllBrands'], []],
    layouts: ['a slim title band over a wide grid', 'a centred heading over a logo wall', 'a heading pinned beside the list'],
    groupLayouts: [
      ['a slim title band over a wide grid', 'a centred heading over a logo wall', 'a heading pinned beside the list'],
      ['a band in the brand colour with light text', 'a centered card floating over a tinted background'],
    ],
  },
  { page: 'footer', label: 'Footer', sections: [1, 1], must: ['FooterLinks'], pool: [['The footer: link columns, social links and the store line']], layouts: ['four link columns over a slim bottom bar', 'a large brand line beside the link columns', 'a band of social links over the link columns', 'a dark band with centred links and social icons'] },
]

const BUSINESS: PageSpec[] = [
  {
    page: 'home',
    label: 'Business home',
    sections: [4, 6],
    must: [],
    pool: [
      ['A trade hero: who the portal serves and a request-a-quote call', 'A split hero with the trade promise and key numbers'],
      ['Categories for trade buyers', 'Best-selling lines for repeat orders'],
      ['How ordering works in steps: browse, quote, order, deliver', 'Why buy wholesale here: pricing tiers, GST invoices, credit'],
      ['Brands carried as a logo strip', 'Trade promises: GST invoices, credit terms, delivery across India'],
      ['A call to request a quote or talk to the trade desk'],
    ],
  },
  {
    page: 'catalog',
    label: 'Trade catalogue',
    sections: [1, 3],
    must: ['ProductResults'],
    pool: [['A title band for the trade catalogue'], ['Filters and sort beside the catalogue results'], ['A note on tier pricing and minimum order']],
    parts: [[], ['Filters', 'SortMenu', 'ProductResults']],
    groupLayouts: [['a band in the brand colour with light text', 'an oversized word or number as the graphic'], ['filters in a column on the left, the grid on the right'], ['a centered card floating over a tinted background', 'three equal columns with thin dividers']],
  },
]

// The store's working pages (account, orders, sign in, policies, help…) are designed now (UTILITY_SPECS); a plan made
// before keeps them here, and their pages keep the theme.
const THEMED: Record<SiteAudience, { key: string; label: string; page?: PageKey; sharedWith?: string }[]> = {
  store: [],
  business: [
    { key: 'product', label: 'Product detail', page: 'product', sharedWith: 'store:product' },
    { key: 'quotes', label: 'Quotes', page: 'quotes' },
    { key: 'account', label: 'Account', page: 'account' },
    { key: 'orders', label: 'Orders', page: 'orders' },
    { key: 'login', label: 'Sign in and sign up', page: 'login' },
    { key: 'pending', label: 'Approval pending' },
  ],
}

export const APPROACHES = [
  { id: 'storyteller', name: 'Storyteller', description: 'The maker and the craft come early; products are woven between the story.' },
  { id: 'catalogue_first', name: 'Catalogue first', description: 'Categories and best sellers up top, quick to shop, little preamble.' },
  { id: 'bazaar', name: 'Bazaar', description: 'Offers and deals lead; dense rows, countdowns and badges.' },
  { id: 'boutique', name: 'Boutique', description: 'Few products, shown large and curated, with lots of space.' },
  { id: 'editorial', name: 'Editorial', description: 'A magazine rhythm: looks, short essays and products in between.' },
  { id: 'gallery', name: 'Gallery', description: 'Image-led, few words; collections as big tiles.' },
  { id: 'community', name: 'Community', description: 'Customers first: reviews, photos and numbers up front.' },
  { id: 'launch', name: 'Launch', description: 'One campaign or collection leads the whole site.' },
] as const

export const LAYOUTS = [
  'full-bleed picture with the words overlaid bottom-left',
  'two columns: picture on one side, words on the other',
  'asymmetric 7/5 grid',
  'centered narrow column with generous space',
  'horizontal scroller with the next card peeking',
  'bento grid with one large tile',
  'a band in the brand colour with light text',
  'cards that overlap slightly, offset vertically',
  'a heading pinned beside a list',
  'three equal columns with thin dividers',
  'an oversized word or number as the graphic',
  'an edge-to-edge marquee strip',
  'a split with the picture bleeding off the edge',
  'a centered card floating over a tinted background',
] as const

const specsFor = (audience: SiteAudience) => (audience === 'business' ? BUSINESS : STORE)

/** The parts the page must contain: what the page needs to work (those the library has) plus what it marks required. */
function mustFor(spec: PageSpec): string[] {
  const allowed = new Set(partsFor(spec.page))
  return [...new Set([...spec.must.filter(p => allowed.has(p)), ...requiredParts(spec.page)])]
}

// The planner sometimes names a section after a component (HeroCarousel, FAQAccordion); the owner reads words.
const plainLabel = (s: string) =>
  /^[A-Z][A-Za-z]+$/.test(s) && /[a-z][A-Z]|[A-Z]{2}[a-z]/.test(s)
    ? s
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(' ')
        .map((w, i) => (i && !/^[A-Z]{2,}$/.test(w) ? w.toLowerCase() : w))
        .join(' ')
    : s

// A label from an idea: its first clause, cut at a word.
const labelOf = (intent: string) => clip(intent.split(/[:,;]/)[0], 40)

/** The layouts that suit a pool group's section: its own list, else the page's. */
const layoutsOf = (spec: PageSpec, group: number): readonly string[] => (spec.groupLayouts?.[group]?.length ? spec.groupLayouts[group] : (spec.layouts ?? LAYOUTS))

/**
 * A layout for a section the planner gave none: one suiting the pool group whose parts it shares most, else one
 * suiting every group of the page, else any of the page's.
 */
function layoutFor(spec: PageSpec | undefined, parts: string[], r: () => number): string {
  const groups = spec?.groupLayouts
  if (spec && groups?.length) {
    let best = -1
    let most = 0
    spec.parts?.forEach((g, i) => {
      const n = g.filter(p => parts.includes(p)).length
      if (n > most && groups[i]?.length) {
        best = i
        most = n
      }
    })
    if (best >= 0) return pick(r, groups[best])
    const shared = groups.reduce((all, g) => all.filter(l => g.includes(l)))
    if (shared.length) return pick(r, shared)
  }
  return pick(r, spec?.layouts ?? LAYOUTS)
}

// The page's section ideas for the planner, with the layouts that suit each group where the page has them.
const ideasText = (spec: PageSpec) =>
  spec.groupLayouts
    ? `ideas, with the layouts that suit each in brackets: ${spec.pool.map((g, i) => `${g.join(' / ')} [${layoutsOf(spec, i).join(' / ')}]`).join('; ')}`
    : `ideas: ${spec.pool.flat().slice(0, 8).join(' / ')}${spec.layouts ? `; layouts that suit it: ${spec.layouts.join(' / ')}` : ''}`

// What a page planned again may draw on: its ideas with their layouts, else a few layouts.
const replanIdeas = (spec: PageSpec, r: () => number) => (spec.groupLayouts ? `Section ${ideasText(spec)}` : `Layout ideas: ${shuffle(r, spec.layouts ?? LAYOUTS).slice(0, 6).join('; ')}`)

function fallbackSections(spec: PageSpec, approach: string, r: () => number): Omit<PlannedSection, 'id'>[] {
  const [min, max] = spec.sections
  let groups = spec.pool
  // The approach reorders the middle of a home page: what it leads with comes first after the hero.
  if (spec.page === 'home' && groups.length > 3) {
    const lead = { storyteller: 4, bazaar: 2, community: 5, gallery: 1, catalogue_first: 1, editorial: 4, boutique: 2, launch: 2 }[approach] ?? 2
    const middle = shuffle(r, groups.slice(1, -1).filter((_, i) => i + 1 !== lead))
    groups = [groups[0], groups[lead], ...middle, groups[groups.length - 1]]
  }
  const n = spec.page === 'home' || spec.page === 'about' ? min + Math.floor(r() * (max - min + 1)) : Math.max(min, Math.min(max, groups.length))
  const chosen = groups.length <= n ? groups : [groups[0], ...groups.slice(1, -1).slice(0, n - 2), groups[groups.length - 1]].slice(0, n)
  return chosen.map(g => {
    const intent = pick(r, g)
    const i = spec.pool.indexOf(g)
    return { label: labelOf(intent), intent, layout: pick(r, layoutsOf(spec, i)), parts: [...(spec.parts?.[i] ?? [])] }
  })
}

/** Required parts each in exactly one section; parts the page can't use dropped. */
function assignParts(sections: Omit<PlannedSection, 'id'>[], spec: PageSpec, page: PageKey): Omit<PlannedSection, 'id'>[] {
  const allowed = new Set(partsFor(page))
  const must = mustFor(spec)
  const seen = new Set<string>()
  const out = sections.map(s => ({ ...s, parts: [...new Set(s.parts)].filter(p => allowed.has(p) && !(must.includes(p) && seen.has(p)) && (seen.add(p), true)) }))
  const missing = must.filter(p => !seen.has(p))
  if (missing.length && out.length) {
    // The section that already holds most of the page's core parts takes the rest (else the first).
    const host = out.reduce((best, s) => (s.parts.filter(p => must.includes(p)).length > best.parts.filter(p => must.includes(p)).length ? s : best), out[0])
    host.parts.push(...missing)
  }
  return out
}

function readSections(raw: unknown, r: () => number, spec?: PageSpec): Omit<PlannedSection, 'id'>[] {
  return listOf(raw, 'sections', 'items')
    .map(item => {
      const o = (item && typeof item === 'object' ? item : { intent: item }) as Record<string, unknown>
      const intent = clip(o.intent ?? o.description ?? o.purpose, 300)
      const parts = (Array.isArray(o.parts) ? o.parts : Array.isArray(o.components) ? o.components : []).map(p => String(p).replace(/[<>/\s]/g, '')).filter(p => /^[A-Z][A-Za-z]+$/.test(p))
      return intent ? { label: plainLabel(clip(o.label ?? o.name ?? o.title, 40, labelOf(intent))), intent, layout: str(o.layout ?? o.composition, 160, layoutFor(spec, parts, r)), parts } : null
    })
    .filter((s): s is NonNullable<typeof s> => !!s)
}

function themedPages(audiences: SiteAudience[]): ThemedPage[] {
  return audiences.flatMap(audience => THEMED[audience].map(t => ({ audience, ...t })))
}

/** The site's pages for the chosen audiences: engaging pages with their sections, and the themed list. */
export async function plan(b: StudioBrief, audiences: SiteAudience[] = ['store']): Promise<StudioPlan> {
  const auds: SiteAudience[] = audiences.includes('business') ? ['store', 'business'] : ['store']
  const r = rng(b.seed, 'plan')
  const candidates = shuffle(r, APPROACHES).slice(0, 3)
  const specs = auds.flatMap(a => specsFor(a).map(spec => ({ audience: a, spec })))
  const out =
    studioBudgetLeft() > 0
      ? await askJson(
          `You plan the pages of a new Indian online store's website, section by section. Every site you plan is different: choose sections, their mix and order for THIS store, not a standard template.
Pick one approach from: ${candidates.map(c => `${c.id} (${c.description})`).join('; ')}.
For each page give its sections in order. Each section: {"label": 2-4 plain words the owner reads (not a component name), "intent": what it shows and why, specific to this store, "layout": its composition (vary it: no two neighbours alike), "parts": library components it uses}.
The category and brand pages are one design each, worn by every category or brand the shopper opens: plan them around <Category> and <Brand>, never a particular category or brand.
Return JSON {"approach": id, "pages": {"<page>": [sections]}}.`,
          `Store: ${b.storeName}. ${b.summary} Sells ${b.category} to ${b.audience}. Price tier ${b.priceTier}. Voice: ${b.voice}. Mood: ${b.mood}.
${b.references.length ? `Sites they like (patterns only): ${b.references.map(x => x.patterns.slice(0, 8).join(', ')).join(' | ')}\n` : ''}Layout ideas to draw on: ${shuffle(r, LAYOUTS).slice(0, 8).join('; ')}.
Pages (key: sections min-max; must contain; ideas):
${specs.map(({ audience, spec }) => `- ${audience === 'business' ? 'business_' : ''}${spec.page}: ${spec.sections[0]}-${spec.sections[1]}; must contain ${mustFor(spec).join(', ') || 'nothing in particular'}; ${ideasText(spec)}; parts available: ${partsFor(spec.page).slice(0, 40).join(', ')}`).join('\n')}`,
          { maxTokens: 7000, temperature: 0.9 }
        ).catch(orNull)
      : null
  const approach = APPROACHES.find(a => a.id === out?.approach) ?? candidates[0]
  const byPage = (out?.pages && typeof out.pages === 'object' ? out.pages : out) as Record<string, unknown> | null
  // The working pages come after, from their pools: kept out of the call so its answer stays short.
  const pages: PlannedPage[] = [...specs, ...UTILITY_SPECS.map(spec => ({ audience: 'store' as SiteAudience, spec }))].map(({ audience, spec }) => {
    const key = `${audience === 'business' ? 'business_' : ''}${spec.page}`
    const [min, max] = spec.sections
    let sections = readSections(byPage?.[key], r, spec).slice(0, max)
    if (sections.length < min) sections = [...sections, ...fallbackSections(spec, approach.id, r).slice(sections.length)].slice(0, Math.max(min, sections.length))
    return {
      key: `${audience}:${spec.page}`,
      audience,
      page: spec.page,
      label: spec.label,
      optional: !!spec.optional,
      enabled: true,
      ...(spec.alsoFor ? { alsoFor: spec.alsoFor } : {}),
      approach: approach.description,
      sections: assignParts(sections, spec, spec.page).map((s, i) => ({ ...s, id: `s${i + 1}` })),
      required: mustFor(spec),
    }
  })
  return { approach: { ...approach }, pages, themed: themedPages(auds) }
}

/** One page's sections planned again (the owner's "regenerate page"), with a fresh seed so it comes out different. */
export async function replanPage(b: StudioBrief, current: StudioPlan, key: string): Promise<PlannedPage | null> {
  const page = current.pages.find(p => p.key === key)
  const showcase = page?.page === 'showcase'
  const spec = page && (showcase ? SHOWCASE : [...specsFor(page.audience), ...(page.audience === 'store' ? UTILITY_SPECS : [])]).find(s => s.page === page.page)
  if (!page || !spec) return null
  const r = rng(b.seed ^ Date.now(), key)
  const out =
    studioBudgetLeft() > 0
      ? await askJson(
          `You plan ${showcase ? "the one page of an Indian business's website" : "one page of an Indian online store's website"} again, differently from before. Return JSON {"sections": [{"label", "intent", "layout", "parts"}]} with ${spec.sections[0]}-${spec.sections[1]} sections. It must contain ${mustFor(spec).join(', ') || 'nothing in particular'}. Parts available: ${partsFor(spec.page).join(', ')}.`,
          `${showcase ? 'Business' : 'Store'}: ${b.storeName}. ${b.summary} Approach: ${current.approach.description}
The page was: ${page.sections.map(s => `${s.label} (${s.layout})`).join('; ')}. Make it different. ${replanIdeas(spec, r)}.`,
          { maxTokens: 1500, temperature: 1 }
        ).catch(orNull)
      : null
  let sections = readSections(out, r, spec).slice(0, spec.sections[1])
  if (sections.length < spec.sections[0]) sections = fallbackSections(spec, current.approach.id, r)
  return { ...page, sections: assignParts(sections, spec, page.page).map((s, i) => ({ ...s, id: `s${i + 1}` })) }
}

/** The plan's page for a key (`store:home`), a bare page key (store), or a PlannedPage itself. */
export function plannedPage(p: StudioPlan, page: PlannedPage | string): PlannedPage | null {
  if (typeof page !== 'string') return page
  return p.pages.find(x => x.key === page) ?? p.pages.find(x => x.audience === 'store' && x.page === page) ?? null
}

/**
 * A page planned from its pools alone (no AI call), for a site whose plan lacks it: Site Builder designing one page
 * of a store the studio never planned. Null for a page the studio does not design.
 */
export function specPage(b: StudioBrief, audience: SiteAudience, page: PageKey, approachId = 'catalogue_first'): PlannedPage | null {
  const spec = [...specsFor(audience), ...(audience === 'store' ? UTILITY_SPECS : [])].find(s => s.page === page)
  if (!spec) return null
  const approach = APPROACHES.find(a => a.id === approachId) ?? APPROACHES[1]
  const sections = fallbackSections(spec, approach.id, rng(b.seed ^ Date.now(), `${audience}:${page}`))
  return {
    key: `${audience}:${page}`,
    audience,
    page,
    label: spec.label,
    optional: !!spec.optional,
    enabled: true,
    ...(spec.alsoFor ? { alsoFor: spec.alsoFor } : {}),
    approach: approach.description,
    sections: assignParts(sections, spec, page).map((s, i) => ({ ...s, id: `s${i + 1}` })),
    required: mustFor(spec),
  }
}

// ── Showcase: a business's one-page site (lib/showcase). One page, `showcase`, under SHOWCASE_PAGE_KEY; no themed
// pages. Its sections read the business through the Showcase parts (code/parts/showcase.tsx).

const SHOWCASE: PageSpec[] = [
  {
    page: 'showcase',
    label: 'Your page',
    sections: [7, 10],
    must: ['LeadForm'],
    pool: [
      ['The header: the logo or name, links to the sections below and a call or WhatsApp button; compact on phones'],
      ['Hero: what the business does in one bold line, the tagline, calls to action to get in touch, and the page\'s picture', 'Split hero: the headline and calls to action beside the page\'s picture', 'Typographic hero: the profession set large with the business name, one contact button and a band with the page\'s picture'],
      ['About: the story in their words, what they do and where', 'About beside the numbers they are proud of'],
      ['Services as cards with their prices', 'Services as a numbered list with descriptions', 'Services in an accordion, quick to scan'],
      ['A gallery of their work', 'Their work as a carousel of large pictures', 'Their work as a bento grid with one large tile'],
      ['The numbers they are proud of in a bold band', 'Numbers beside a short line on why clients choose them'],
      ['What clients say, as a wall of quotes', 'What clients say in a carousel with ratings'],
      ['Questions clients ask, in an accordion'],
      ['Contact: the enquiry form beside phone, WhatsApp, email, address, hours and a map link', 'Contact: a band with call and WhatsApp buttons over the enquiry form'],
      ['The footer: name, a short line, contact, social links and the year'],
    ],
    parts: [['Business'], ['Business', 'BusinessPicture'], ['Business'], ['Services'], ['Work'], ['Stats'], ['Testimonials'], ['Faqs'], ['LeadForm', 'Business'], ['Business', 'SocialLinks']],
  },
]

export const SHOWCASE_APPROACHES = [
  { id: 'portfolio', name: 'Portfolio', description: 'The work leads: big pictures early, words kept short.' },
  { id: 'trusted', name: 'Trusted', description: 'Proof first: the numbers and what clients say come right after the hero.' },
  { id: 'personal', name: 'Personal', description: 'The person behind the business leads: their story, then the work and services.' },
  { id: 'practical', name: 'Practical', description: 'Services and how to book up front; getting in touch is never more than a tap away.' },
  { id: 'local', name: 'Local favourite', description: 'Warm and neighbourly: hours, address and a call button stay close.' },
] as const

/** A Showcase's plan: its one page, with sections chosen for this business (the pool fills in when the AI can't). */
export async function planShowcase(b: StudioBrief): Promise<StudioPlan> {
  const spec = SHOWCASE[0]
  const r = rng(b.seed, 'plan:showcase')
  const candidates = shuffle(r, SHOWCASE_APPROACHES).slice(0, 3)
  const out =
    studioBudgetLeft() > 0
      ? await askJson(
          `You plan a one-page website for an Indian business, section by section, top to bottom. Every page you plan is different: choose the sections, their mix and order for THIS business, not a standard template.
Pick one approach from: ${candidates.map(c => `${c.id} (${c.description})`).join('; ')}.
Each section: {"label": 2-4 plain words the owner reads (not a component name), "intent": what it shows and why, specific to this business, "layout": its composition (vary it: no two neighbours alike), "parts": library components it uses}.
Start with the header (the name or logo, links to the sections below, a call or WhatsApp button), then the opening, which holds <BusinessPicture>, and end with the footer; one section near the end is for getting in touch and holds <LeadForm>. A section built only on services, work, reviews, numbers or questions shows only once the business has some.
Return JSON {"approach": id, "sections": [sections]}.`,
          `Business: ${b.storeName}. ${b.summary} What they do: ${b.category}. Clients: ${b.audience}. Voice: ${b.voice}. Mood: ${b.mood}.
${b.references.length ? `Sites they like (patterns only): ${b.references.map(x => x.patterns.slice(0, 8).join(', ')).join(' | ')}\n` : ''}Layout ideas to draw on: ${shuffle(r, LAYOUTS).slice(0, 8).join('; ')}.
${spec.sections[0]}-${spec.sections[1]} sections; must contain ${mustFor(spec).join(', ')}; ideas: ${spec.pool.flat().join(' / ')}; parts available: ${partsFor(spec.page).join(', ')}`,
          { maxTokens: 3000, temperature: 0.9 }
        ).catch(orNull)
      : null
  const approach = SHOWCASE_APPROACHES.find(a => a.id === out?.approach) ?? candidates[0]
  let sections = readSections(out, r, spec).slice(0, spec.sections[1])
  if (sections.length < spec.sections[0]) sections = fallbackSections(spec, approach.id, r)
  const page: PlannedPage = {
    key: SHOWCASE_PAGE_KEY,
    audience: 'store',
    page: spec.page,
    label: spec.label,
    optional: false,
    enabled: true,
    approach: approach.description,
    sections: assignParts(sections, spec, spec.page).map((s, i) => ({ ...s, id: `s${i + 1}` })),
    required: mustFor(spec),
  }
  return { approach: { ...approach }, pages: [page], themed: [] }
}
