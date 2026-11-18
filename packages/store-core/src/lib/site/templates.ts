import { randomUUID } from 'crypto'
import { normalizeDoc, type PageDoc, type SiteTemplate, type TemplatePage } from '@jeffi/site-blocks'
import { queryMany, queryOne } from '@/lib/shared/db'
import { DEFAULT_SECTIONS, type HomepageSection } from '@/lib/catalog/homepage-sections'
import { sectionsToDoc } from './legacy'
import { siteRegistry } from './blocks'
import { sitePacks } from './packs'

// Built-in page templates (more, per archetype, come with the template library) and the ones an owner saved.

const rows = (types: Partial<HomepageSection>[]): HomepageSection[] =>
  types.map((s, i) => ({
    id: randomUUID(), title: null, subtitle: null, eyebrow: null, cta_label: null, cta_url: null, config: {},
    display_order: i, is_active: true, starts_at: null, ends_at: null, type: 'product_row', ...s,
  }) as HomepageSection)

const home = (doc: PageDoc): TemplatePage[] => [{ audience: 'store', surface: 'web', page: 'home', doc }]

/** A document from block types and settings (the rest from each block's defaults). */
function blocksDoc(list: { type: string; props?: Record<string, unknown> }[]): PageDoc {
  const blocks = list.map(b => {
    const def = siteRegistry.get(b.type)!
    return { id: randomUUID(), type: b.type, v: def.v, props: def.props.parse(b.props ?? {}) as Record<string, unknown> }
  })
  return normalizeDoc({ blocks: Object.fromEntries(blocks.map(b => [b.id, b])), order: blocks.map(b => b.id) })
}
const on = (pages: TemplatePage['page'][], doc: PageDoc): TemplatePage[] => pages.map(page => ({ audience: 'store', surface: 'web', page, doc }))

export function builtInTemplates(): SiteTemplate[] {
  return [...pageTemplates(), ...sitePacks()]
}

function pageTemplates(): SiteTemplate[] {
  return [
    {
      id: 'builtin:classic-store',
      name: 'Classic store',
      description: 'Hero banner, categories, product rows, brands and reasons to buy. A safe start for any catalogue.',
      kind: 'page',
      archetype: 'bazaar_dense',
      pages: home(sectionsToDoc(rows(DEFAULT_SECTIONS.map(s => ({ ...s }))))),
    },
    {
      id: 'builtin:minimal-showcase',
      name: 'Minimal showcase',
      description: 'One bold animated hero, a few categories and new arrivals, then your story. Lets the products breathe.',
      kind: 'page',
      archetype: 'minimal_modern',
      pages: home(
        sectionsToDoc(
          rows([
            { type: 'motion_hero' },
            { type: 'category_grid', title: 'Shop by category' },
            { type: 'product_row', title: 'New arrivals', config: { source: 'new_arrivals', limit: 8, layout: 'grid' } },
            { type: 'about' },
            { type: 'testimonials', title: 'What customers say' },
          ])
        )
      ),
    },
    {
      id: 'builtin:deals-first',
      name: 'Deals first',
      description: 'Offers up top: offer slider, countdown deal, deal of the day and best sellers. For sale-driven stores.',
      kind: 'page',
      archetype: 'bold_playful',
      pages: home(
        sectionsToDoc(
          rows([
            { type: 'offer_slider' },
            { type: 'countdown_deal' },
            { type: 'deal_of_the_day' },
            { type: 'product_row', title: 'Best sellers', config: { source: 'best_sellers', limit: 8, layout: 'carousel' } },
            { type: 'category_grid', title: 'Shop by category' },
            { type: 'trust_strip' },
          ])
        )
      ),
    },
    {
      id: 'builtin:our-story',
      name: 'Our story',
      description: 'A banner, your story, how you make things and what customers say. For About or a brand page.',
      kind: 'page',
      archetype: 'craft_earthy',
      pages: on(
        ['about', 'custom'],
        blocksDoc([
          { type: 'image_banner', props: { heading: 'Our story', subheading: 'How it started, and what we still care about.', height: 'short' } },
          { type: 'rich_text', props: { heading: 'Who we are', align: 'center' } },
          { type: 'image_text', props: { heading: 'How we make it', imageSide: 'left' } },
          { type: 'image_text', props: { heading: 'Why customers come back', imageSide: 'right' } },
          { type: 'testimonials', props: { title: 'What customers say' } },
        ])
      ),
    },
    {
      id: 'builtin:contact-faq',
      name: 'Contact and FAQ',
      description: 'Ways to reach you, opening hours and the questions customers ask most.',
      kind: 'page',
      archetype: 'minimal_modern',
      pages: on(
        ['contact', 'support', 'custom'],
        blocksDoc([
          { type: 'rich_text', props: { heading: 'We are here to help', body: 'Write to us, call, or visit. We reply within one working day.', align: 'center' } },
          { type: 'contact_details' },
          {
            type: 'faq',
            props: {
              items: [
                { q: 'How long does delivery take?', a: 'Most orders arrive in 3 to 7 working days.' },
                { q: 'Can I return an item?', a: 'Yes, within the return window shown on the product page, if it is unused.' },
                { q: 'Do you offer GST invoices?', a: 'Yes. Add your GSTIN at checkout and the invoice carries it.' },
              ],
            },
          },
        ])
      ),
    },
    {
      id: 'builtin:product-reassure',
      name: 'Product page: reassure and upsell',
      description: 'The product, then delivery and returns promises, common questions and best sellers.',
      kind: 'page',
      archetype: 'minimal_modern',
      pages: on(
        ['product'],
        blocksDoc([
          { type: 'product_main' },
          { type: 'trust_strip' },
          {
            type: 'faq',
            props: {
              heading: 'Before you buy',
              items: [
                { q: 'When will it arrive?', a: 'Most orders ship in 1 to 2 working days and arrive in 3 to 7.' },
                { q: 'Can I return it?', a: 'Yes, unused items can be returned within the window shown above.' },
                { q: 'Is it genuine?', a: 'Every product is sourced from the brand or its authorised distributors.' },
              ],
            },
          },
          { type: 'product_row', props: { title: 'Customers also bought', config: { source: 'best_sellers', limit: 8, layout: 'carousel' } } },
        ])
      ),
    },
    {
      id: 'builtin:cart-upsell',
      name: 'Cart with suggestions',
      description: 'The cart, then deals worth adding and your store promises.',
      kind: 'page',
      archetype: 'bazaar_dense',
      pages: on(
        ['cart'],
        blocksDoc([
          { type: 'cart_main' },
          { type: 'product_row', props: { title: 'Add a little extra', config: { source: 'on_sale', limit: 8, layout: 'carousel' } } },
          { type: 'trust_strip' },
        ])
      ),
    },
    {
      id: 'builtin:checkout-reassure',
      name: 'Checkout with reassurance',
      description: 'Your store promises above the checkout and the usual payment questions below it. The payment flow is unchanged.',
      kind: 'page',
      archetype: 'minimal_modern',
      pages: on(
        ['checkout'],
        blocksDoc([
          { type: 'trust_strip' },
          { type: 'checkout_main' },
          {
            type: 'faq',
            props: {
              heading: 'Paying safely',
              items: [
                { q: 'Which payment methods can I use?', a: 'UPI, cards, net banking and wallets, and cash on delivery where it is offered.' },
                { q: 'Is my payment secure?', a: 'Payments go through a PCI-compliant gateway; we never see or store your card details.' },
                { q: 'Can I change the address after ordering?', a: 'Yes, from the order page until it ships.' },
              ],
            },
          },
        ])
      ),
    },
    {
      id: 'builtin:track-help',
      name: 'Order tracking with help',
      description: 'The order and its tracking, then delivery questions and products to add to the next order.',
      kind: 'page',
      archetype: 'bazaar_dense',
      pages: on(
        ['track'],
        blocksDoc([
          { type: 'track_main' },
          { type: 'faq', props: { heading: 'About your delivery', items: [{ q: 'My order is late. What now?', a: 'Tracking updates can lag a day; if the delivery date passes, write to support with the order number.' }, { q: 'Can I return an item?', a: 'Choose Return on the item above within the return window.' }] } },
          { type: 'product_row', props: { title: 'For your next order', config: { source: 'best_sellers', limit: 8, layout: 'carousel' } } },
        ])
      ),
    },
    {
      id: 'builtin:auth-welcome',
      name: 'Sign in with a welcome',
      description: 'The form beside a welcome panel with the reasons to have an account. Add your own picture.',
      kind: 'page',
      archetype: 'minimal_modern',
      pages: [
        ...on(['login'], blocksDoc([{ type: 'login_main', props: { sideHeading: 'Welcome back', sideText: 'Track orders, reorder in a tap and keep your saved addresses.' } }])),
        ...on(['signup'], blocksDoc([{ type: 'signup_main', props: { sideHeading: 'Join us', sideText: 'Faster checkout, order tracking, rewards on every purchase and early access to offers.' } }])),
      ],
    },
    {
      id: 'builtin:account-offers',
      name: 'Account with offers',
      description: 'The account overview, then offers for members and help.',
      kind: 'page',
      archetype: 'bazaar_dense',
      pages: on(
        ['account'],
        blocksDoc([
          { type: 'account_main' },
          { type: 'product_row', props: { title: 'Picked for you', config: { source: 'best_sellers', limit: 8, layout: 'carousel' } } },
          { type: 'faq', props: { heading: 'Need help?', items: [{ q: 'Where is my order?', a: 'Open the order above to see its tracking and delivery date.' }, { q: 'How do I return something?', a: 'Open the order and choose Return on the item, within the return window.' }] } },
        ])
      ),
    },
    {
      id: 'builtin:landing',
      name: 'Landing page',
      description: 'A campaign banner, two highlights, featured products and questions. For a sale, launch or collection.',
      kind: 'page',
      archetype: 'bold_playful',
      pages: on(
        ['custom'],
        blocksDoc([
          { type: 'image_banner', props: { heading: 'The new collection', subheading: 'Made for the season. Limited quantities.', ctaLabel: 'Shop now', ctaUrl: '/products', height: 'tall' } },
          { type: 'image_text', props: { heading: 'Made to last', imageSide: 'left' } },
          { type: 'image_text', props: { heading: 'Designed for you', imageSide: 'right' } },
          { type: 'product_row', props: { title: 'Shop the collection', config: { source: 'new_arrivals', limit: 8, layout: 'grid' } } },
          { type: 'faq' },
        ])
      ),
    },
  ]
}

export async function savedTemplates(): Promise<SiteTemplate[]> {
  const r = await queryMany<{ id: string; name: string; description: string | null; kind: SiteTemplate['kind']; archetype: string | null; pages: TemplatePage[] }>(
    `SELECT id, name, description, kind, archetype, pages FROM site_templates ORDER BY updated_at DESC`
  ).catch(() => [])
  return r.map(t => ({ ...t, description: t.description ?? undefined, archetype: (t.archetype ?? undefined) as SiteTemplate['archetype'], pages: t.pages }))
}

export async function saveTemplate(t: { name: string; description?: string | null; kind?: 'block'; pages: TemplatePage[] }, adminId: string | null) {
  const pages = t.pages.map(p => ({ ...p, doc: normalizeDoc(p.doc) }))
  const row = await queryOne<{ id: string }>(
    `INSERT INTO site_templates (name, description, kind, pages, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [t.name.trim(), t.description?.trim() || null, t.kind ?? (pages.length > 1 ? 'site' : 'page'), JSON.stringify(pages), adminId]
  )
  return row!.id
}

export async function deleteTemplate(id: string): Promise<boolean> {
  return !!(await queryOne(`DELETE FROM site_templates WHERE id = $1 RETURNING id`, [id]))
}
