import type { PageKey } from '@jeffi/site-blocks'
import { HTML_TAGS, LIBRARY_MODULE } from '../code/allow'
import { codeRules } from '../code/library'
import { PRODUCT_FIELDS } from '../code/parts/common'
import { libraryText } from './library'
import type { DesignDirection, PlannedPage, PlannedSection, StudioBrief } from './types'
import { uiStyle } from './ui-styles'
import { utilityRules } from './utility'

// The section prompts: who writes, the code engine's TSX rules (codeRules), responsive and theme rules, the page's
// component library, then the store, the direction, the page plan and the one section asked for.

// What the code engine's rules (codeRules) leave to the studio.
// The section is written against a sample catalogue but goes live on the store's own, which starts empty.
const DATA_RULE = [
  'Never type product names, prices, ratings, reviews or offers yourself: they come from the data components, so the section stays live when real products replace the sample ones.',
  'Never name a category, brand or product by slug or text (no category: "dog-food", no "/categories/cats", no tabs per category): the live store has its own. List them with <Categories>/<Brands> and link with c.url, b.url, p.url; filter <Products> by sort, featured or onSale.',
  'Pictures only from data (p.image, c.image, o.image, h.image, s.logo). Never an <Image> without a src: where there is no picture, design with colour, type and icons.',
  'On the home page the opening section always shows a picture, through <HeroPicture> (the first live offer\'s picture, else a featured product\'s photo, else a category\'s, else a designed fill): most stores have no offer with a picture, so never take its only picture from <Offers>. With {h => …}, h.kind === "offer" is a campaign picture for a full-bleed banner; a product or category photo sits beside the words.',
  'A grid of store data must suit any number of items: for a mosaic with one large tile use layout="mosaic", which fits any count; a plain grid needs no spans. itemClassName styles each item.',
  'Phone, email, address and WhatsApp only through <Store>{s => …}</Store>; s.whatsapp may be empty, so guard it: {s.whatsapp && <Link href={`https://wa.me/${s.whatsapp}`} className="…">…</Link>}. Social profiles only through <SocialLinks /> with no props: it shows the profiles the owner set, so never type a social link. An email sign-up only through <NewsletterForm />, where the library has it: it signs shoppers up to the store\'s offer emails.',
  'The store may have no products, categories, brands, reviews or offers yet: a section built only on them stays hidden until they exist, so the first section of a page must not depend on them.',
].join(' ')

// Products always show as the site's own product card (cardSystem below), the same in every list.
const CARD_RULE =
  "Products show as the site's own product card, designed once for this site and the same everywhere: <Products>, <ProductResults>, <RelatedProducts> and <CartUpsell> draw it by themselves, so lay them out with className (a grid, or layout=\"carousel\") and give them no render function. Never give <ProductResults> one (it would lose the endless scroll). Write {p => …} on <Products> only for a layout a card cannot make (a large spotlight, a numbered list, names in a marquee), with <QuickAdd product={p} /> to add to cart and <PriceTag product={p} /> for the price, both outside any link. Cards need room: a grid of them spans the page or its main column; in a narrow column or a slider each card gets a row or a slide of its own (layout=\"carousel\" makes the list itself the slider), never a grid of several columns inside a slide, a <Carousel> or a sidebar."

// The catalogue pages serve every category, brand or search: what is on them comes from the page's own record
// (parts/taxonomy.ts), never typed (studioLint flags a typed <h1> on a category or brand page).
const PAGE_RULES: Partial<Record<PageKey, string>> = {
  category:
    "This design serves every category page. The page's own category comes from <Category>{c => …}</Category>: its h1 is {c.name}, never typed text, with c.tagline, c.description, c.image (and c.mobileImage), c.parentName/c.parentUrl and c.productCount. <SubCategories> lists its subcategories, <CategoryFaqs> its questions, <SeoText> its longer copy (under the products), <Breadcrumbs> the trail and <ProductResults> its products. Each draws nothing when the category has none, so no section may depend on them alone.",
  brand:
    "This design serves every brand page. The page's own brand comes from <Brand>{b => …}</Brand>: its h1 is {b.name}, never typed text, with b.logo, b.tagline, b.description, b.story, b.image (and b.mobileImage), b.founded, b.origin and b.socials (map them to links). <SeoText> gives its longer copy (under the products), <Breadcrumbs> the trail and <ProductResults> its products.",
  products: '<Breadcrumbs> gives the trail above the products; <ProductResults> the products themselves.',
  search:
    "This design serves every search. What the shopper searched for comes from <SearchQuery>{q => …}</SearchQuery>: the heading uses q.term and q.total, never typed text. <SearchBox variant=\"bar\" /> lets them search again, <Breadcrumbs> gives the trail and <ProductResults> the matches.",
  categories:
    "This page lists every category: <AllCategories> (required) draws them, {c => …} per category with c.children for its subcategories; <Breadcrumbs> gives the trail. Its heading is about the store's range, never a category's name.",
  brands:
    "This page lists every brand: <AllBrands> (required) draws them, featured first, {b => …} per brand; <Breadcrumbs> gives the trail. Its heading is about the brands the store carries, never one brand's name.",
}

// studioLint's navMenu note catches a header that breaks it.
const HEADER_RULE =
  'This is only the header: the announcement bar is its own section above it, so add no promo, offer or message strip here. On phones and tablets the menu button sits in the logo row, at its left or right edge: never alone on a row, never centred. <NavLinks> draws that button below the width its links show from (from="lg" by default; from="md" shows them from 768px). Links on a centred row of their own (a centred logo over the menu, a wide search with the menu below) need mobile="scroll" on <NavLinks> (that row then keeps its links, scrolling on phones), or <NavLinks> kept at an edge of the logo row until the links move to their own row, with from set to that width.'

export const RESPONSIVE = `One source serves desktop and phone: write mobile-first. Base classes are for phones (320-430px wide), then sm: md: lg: xl: for wider screens. Nothing may overflow at 320px (use flex-wrap, grid-cols-1 or 2 on phones, overflow-x-auto only for an intended scroller). Tap targets at least 44px tall; body text at least text-base on phones.`

const RADIUS = { none: 'rounded-none', sm: 'rounded-md', md: 'rounded-xl', lg: 'rounded-2xl', full: 'rounded-3xl' } as const

export function themeRules(d: DesignDirection): string {
  const t = d.theme
  return `Colours only from the theme: primary-50…900 (brand), accent-50…900, secondary-50…900 (the dark neutral: text and dark bands), the surface/foreground classes, white and black. Never arbitrary colours (no bg-[#…]); opacity modifiers (/80) work on the primary, secondary and accent scales only. Headings: font-display${t.headingCase === 'upper' ? ' uppercase' : ''}${t.headingTracking === 'wide' ? ' tracking-widest' : t.headingTracking === 'tight' ? ' tracking-tight' : ''}. Corners: ${RADIUS[t.radius] ?? 'rounded-xl'} for cards and pictures${t.buttonShape === 'pill' ? ', rounded-full buttons' : t.buttonShape === 'square' ? ', square buttons' : ''}. Cards: ${t.cardStyle === 'shadow' ? 'shadow-md' : t.cardStyle === 'outlined' ? 'a thin border' : 'flat, no border'}. Spacing: ${t.density === 'airy' ? 'generous (py-16 md:py-28)' : t.density === 'compact' ? 'tight (py-6 md:py-10)' : 'balanced (py-10 md:py-16)'}.`
}

export function sectionSystem(page: PageKey, d: DesignDirection): string {
  if (page === 'showcase') return showcaseSystem(d)
  if (page === 'card') return cardSystem(d)
  return `You are a senior web designer and front-end developer. You write ONE section of a page of an Indian online store as a React component in TSX, styled with Tailwind CSS. Make it distinctive and specific to this store: a real designer's composition, not a generic template.

${codeRules()}
${DATA_RULE}
${CARD_RULE}

${RESPONSIVE}

${themeRules(d)}

Copy: Indian English, specific to this store and its shoppers, short headings, no emoji, no prices, discounts, offer codes, numbers (customers served, years, orders, pin codes) or claims you were not given. Never invent quotes, testimonials, people, experts, panels, awards, certifications, guarantees, or free-shipping, delivery or returns promises the brief does not give. The section labels in the plan are notes for you, not headings: write real headings.

${page === 'header' ? `${HEADER_RULE}\n\n` : ''}${PAGE_RULES[page] ? `${PAGE_RULES[page]}\n\n` : ''}${utilityRules(page)}Reply with one \`\`\`tsx code block and nothing else.

Component library for this page:
${libraryText(page)}`
}

export function briefText(b: StudioBrief): string {
  if (b.kind === 'showcase') return showcaseBriefText(b)
  const st = uiStyle(b.uiStyle)
  const refs = b.references ?? []
  return `Store: ${b.storeName}. ${b.summary}
Sells: ${b.category}. Shoppers: ${b.audience}. Price tier: ${b.priceTier}.
Voice: ${b.voice}. Words shoppers use: ${b.vocabulary.join(', ') || 'none given'}.${b.contact || b.socials ? `\nWays to reach the store (show them only from <Store>): ${[...Object.keys(b.contact ?? {}), ...Object.keys(b.socials ?? {})].join(', ')}.` : ''}
Mood: ${b.mood}. Photography: ${b.artDirection}${st ? `\nDesign style the owner picked (follow it in every section): ${st.rules}` : ''}${
    refs.length
      ? `\nSites the owner likes (take their layout feel and rhythm, never their words or pictures): ${refs.map(r => `${r.url}: ${r.feel} ${r.density} spacing, ${r.imageLed ? 'picture-led' : 'type-led'}${r.uppercaseLabels ? ', uppercase labels' : ''}; sections ${r.patterns.slice(0, 6).join(', ')}`).join(' | ')}`
      : ''
  }`
}

export function directionText(d: DesignDirection): string {
  const t = d.theme
  return `Design direction "${d.name}": ${d.layoutFeel}. Palette: primary ${t.primary}, accent ${t.accent}, neutral ${t.neutral}. Fonts: ${t.fontDisplay} for headings, ${t.fontBody} for text. Shape: ${t.radius} corners, ${t.buttonShape} ${t.buttonStyle} buttons, ${t.cardStyle} cards, ${t.shadow} shadows; ${t.density} spacing.`
}

export function sectionUser(b: StudioBrief, d: DesignDirection, p: PlannedPage, s: PlannedSection, index: number): string {
  const must = s.parts.length ? `It must contain: ${s.parts.map(x => `<${x}>`).join(', ')}${s.parts.includes('PaymentStep') ? ' (PaymentStep exactly once, as it is: it is the locked payment step)' : ''}.` : ''
  return `${briefText(b)}

${directionText(d)}

Page: ${p.label}. ${p.approach}
The page's sections, in order:
${p.sections.map((x, i) => `${i === index ? '→' : ' '} ${i + 1}. ${x.label}: ${x.intent} (${x.layout})`).join('\n')}

Write section ${index + 1}, "${s.label}": ${s.intent}
Composition: ${s.layout}. Make it look different from its neighbours.
${must}`.trim()
}

export function repairText(issues: string[]): string {
  return `The store's compiler rejected that component:
${issues.slice(0, 12).map(i => `- ${i}`).join('\n')}
Fix exactly these problems, keep the design, and return the whole component again in one \`\`\`tsx block.`
}

export function tweakUser(b: StudioBrief, d: DesignDirection, label: string, source: string, instruction: string): string {
  return `${briefText(b)}

${directionText(d)}

This is the section "${label}":
\`\`\`tsx
${source}
\`\`\`

Change it as the owner asks: ${instruction}
Keep everything else, keep every library component it uses, and return the whole component in one \`\`\`tsx block.`
}

// ── The site card: one product card per site (lib/site/card.ts), drawn by every product list. Written once, early in
// the build, for the direction and the owner's style.

const cardFields = () =>
  Object.entries(PRODUCT_FIELDS)
    .map(([k, v]) => `p.${k} (${v})`)
    .join(', ')

export function cardSystem(d: DesignDirection): string {
  return `You are a senior web designer and front-end developer. You design the product card of an Indian online store: the one card every product list on its site draws its products with (home sections, listings and search with endless scroll, related products, the cart's suggestions). Write it as ONE React component in TSX, styled with Tailwind CSS, made for this store's design style so it belongs with the sections around it.

The card:
- \`export default function Card({ p }) { return (…) }\`, where p is the product. Its fields: ${cardFields()}. Optionally \`import { … } from '${LIBRARY_MODULE}'\`; no other imports and no other functions; \`const NAME = <literal>\` is allowed before the return.
- Only HTML tags (${[...HTML_TAGS].join(', ')}), <Image>, <Link>, <Icon> and the card parts below. Tailwind classes only: string literals, template literals or ternaries of literals (className={p.inStock ? '…' : '…'}). No style, event handlers, refs or spreads, and no function calls (p.price.formatted is already text).
- ONE link opens the product, stretched over the whole card: <h3 …><Link href={p.url} className="… after:absolute after:inset-0 after:content-['']">{p.name}</Link></h3>, with relative on the card's root. Never wrap the card, the picture or a button in a link. <QuickAdd> and <WishlistToggle> already sit above the stretched link, so they stay tappable.
- The picture: <Image src={p.image} hoverSrc={p.hoverImage} alt={p.name} aspect="…" sizes="(min-width: 1024px) 25vw, 50vw" /> in one fixed aspect (4:5, 1:1 or 3:4) so cards in a row line up; a product without a picture gets a tinted fill by itself.
- Always the name (line-clamp-2), the price as <PriceTag product={p} /> and the add-to-cart button <QuickAdd product={p} className="…" />, styled for this design. Add what suits the style from <DiscountBadge>, <WishlistToggle> (on a corner of the picture), <RatingStars>, <StockBadge>, p.brand or p.category as a small label, and p.badge.
- Phones first: two cards share a 360px phone row (about 160px each), so small text (text-xs, the name text-sm), tight padding (p-2 or p-3), a button at least 44px tall (min-h-[44px]) and nothing wider than the card; from sm: up it may breathe. h-full flex flex-col on the root and mt-auto on the price-and-button block, so cards in a row end level.
- Hover effects only from sm: or lg: up (the picture zooms or swaps to p.hoverImage, the shadow or border shifts) and none that hides the price or the button, which touch screens never hover.
- Accessible: the name in an <h3>, a visible focus ring on the link (focus-visible:outline-none focus-visible:after:ring-2 …), text contrast of at least 4.5:1 on its background, and no meaning carried by colour alone.
- Never type a product name, price, rating, brand or badge: every value comes from p.

${themeRules(d)}

Reply with one \`\`\`tsx code block and nothing else.

Card parts and the pieces a card may use:
${libraryText('card')}`
}

export function cardUser(b: StudioBrief, d: DesignDirection): string {
  const st = uiStyle(b.uiStyle)
  return `${briefText(b)}

${directionText(d)}

Design this store's product card${st ? ` in its ${st.name} style. A card in that style: ${st.card}` : ', in this direction'}.
It repeats many times on every page: calm enough to repeat, and unmistakably this site's.`
}

// ── Showcase: a business's one-page site (lib/showcase, page `showcase`). Its own rules instead of the store's: no
// shop parts, its details and content only through the Showcase parts, and sections linked by anchors.

const SHOWCASE_RULES = [
  'This site sells nothing online: there are no products, prices to buy at, cart, checkout or shop parts (Products, Categories, Brands, Reviews, Offers, Store, ProductCard are not available). Use only the Showcase parts below and the decoration parts (Image, Link, Icon, Carousel, Tabs, Accordion, Marquee, Reveal).',
  "The business's details and content come only from its parts, so the page follows when the owner edits them: name, tagline, logo, about, phone, WhatsApp, email, address, hours and map from <Business>{b => …}</Business>; services and their prices from <Services>, work pictures from <Work>, client quotes from <Testimonials>, numbers from <Stats>, questions from <Faqs>, enquiries through <LeadForm />, social profiles with <SocialLinks />. Never type a name, phone number, email, address, hours, service, price, number, quote or question yourself.",
  'Contact links only from <Business>: href={b.whatsappUrl}, href={b.phoneUrl}, href={b.emailUrl}, href={b.mapUrl}. The business may not have given each one: guard it, e.g. {b.whatsappUrl && <Link href={b.whatsappUrl} className="…">Chat on WhatsApp</Link>}.',
  'A detail the business did not give has no row at all: show hours, address, phone, WhatsApp and email only when given, guarding each row (b.hours && …) or drawing the rows from b.facts. Never write a stand-in for a missing one ("Call for today\'s hours", "Message us for timings", "In your neighbourhood", "Address on request", "Coming soon").',
  'One page, linked by anchors: give a section an id from top, about, services, work, reviews, faq, contact (<section id="services">) and link to it with <Link href="#services">. The header links only to the sections the plan has; a section that draws nothing takes its links with it, so never link to an id no section has.',
  'The opening section (the one holding the page\'s h1) always shows a picture through <BusinessPicture> (the owner\'s work photo, else a picture made for this page, else a designed fill); a later section may show <BusinessPicture index={1}>. Other pictures only from data (s.image, w.image, t.avatar, b.logo); never an <Image> without a src (b.initial makes a mark when there is no logo).',
  'Never present a picture as the owner\'s work unless it is: a gallery of their work is <Work> alone (their own uploads), and a <BusinessPicture> is captioned as their work only when p.kind === "work".',
  'Client quotes, names and ratings come only from <Testimonials>: never type a quote, a review, a client\'s name or a star rating. A reviews section shows real reviews or nothing.',
  'The business may have no services, work, testimonials, numbers or questions yet: a section built only on them stays hidden until they exist, so the header, hero and contact sections must not depend on them.',
].join(' ')

function showcaseSystem(d: DesignDirection): string {
  return `You are a senior web designer and front-end developer. You write ONE section of the one-page website of an Indian business or professional as a React component in TSX, styled with Tailwind CSS. The page shows who they are, their work, proof and reviews, and gets them enquiries. Make it distinctive and specific to this business: a real designer's composition, not a generic template.

${codeRules()}
${SHOWCASE_RULES}

${RESPONSIVE}

${themeRules(d)}

Copy: Indian English, specific to this business and its clients, short headings, no emoji, no prices, opening hours, addresses, numbers (clients served, years, projects, ratings) or claims you were not given. Never invent quotes, testimonials, people, a founding story, awards, certifications, guarantees or promises the brief does not give. The section labels in the plan are notes for you, not headings: write real headings.

Reply with one \`\`\`tsx code block and nothing else.

Component library for this page:
${libraryText('showcase')}`
}

function showcaseBriefText(b: StudioBrief): string {
  const st = uiStyle(b.uiStyle)
  const refs = b.references ?? []
  const reach = [...Object.keys(b.contact ?? {}), ...Object.keys(b.socials ?? {})]
  return `Business: ${b.storeName}. ${b.summary}
What they do: ${b.category}. Clients: ${b.audience}. Price level: ${b.priceTier}.
Voice: ${b.voice}. Words their clients use: ${b.vocabulary.join(', ') || 'none given'}.${reach.length ? `\nWays to reach them (show them only from <Business>): ${reach.join(', ')}.` : ''}
Mood: ${b.mood}. Pictures: ${b.artDirection}${st ? `\nDesign style the owner picked (follow it in every section): ${st.rules}` : ''}${
    refs.length
      ? `\nSites the owner likes (take their layout feel and rhythm, never their words or pictures): ${refs.map(r => `${r.url}: ${r.feel} ${r.density} spacing, ${r.imageLed ? 'picture-led' : 'type-led'}${r.uppercaseLabels ? ', uppercase labels' : ''}; sections ${r.patterns.slice(0, 6).join(', ')}`).join(' | ')}`
      : ''
  }`
}
