import 'server-only'
import { cleanAnswers } from '@/lib/site/studio'
import type { SampleCatalog } from '@/lib/site/data/types'
import { parseThemeId, themeDirection, themeTokens } from '@/lib/site/themes/catalog'
import { themeSite } from '@/lib/site/themes/apply'
import { SHOWCASE_HOME, templateFile, themePages, type ThemeProduct } from '@/lib/site/themes/pages'
import { themeSample } from '@/lib/site/themes/sample'
import { SEED_CATALOGS } from '@controller/lib/provisioning/seed-catalog'
import { ownerShowcase } from '@controller/lib/showcase-builder/site'
import { copyStudioPage } from '@controller/lib/showcase-builder/publish'
import { detailsAnswers, startShowcaseStudio } from '@controller/lib/showcase-builder/studio'
import { studioStoreAnswers, studioStoreContext, type StudioStoreContext } from './context'
import { buildRunning, getStudioSession, startStudioSession, updateStudioSession, type StudioProduct, type StudioSession } from './sessions'

// Ready-made themes in the studio (lib/site/themes): the owner's studio opened without AI, a theme applied as its whole
// site (the free generation untouched: free_used_at, generated_at and the spend stay as they were), and a theme
// previewed over the owner's details before it is applied.

/** The sample's store as the Store step has it (what syncStudioStore keeps it in step with). */
export function sampleStore(ctx: StudioStoreContext): SampleCatalog['store'] {
  return {
    name: ctx.storeName,
    logo: ctx.logoUrl,
    email: ctx.contact.email ?? '',
    phone: ctx.contact.phone ?? '',
    address: ctx.contact.address ?? '',
    ...(ctx.contact.whatsapp ? { whatsapp: ctx.contact.whatsapp } : {}),
    ...(Object.keys(ctx.socials).length ? { socials: ctx.socials } : {}),
    ...(ctx.tagline ? { tagline: ctx.tagline } : {}),
    ...(ctx.about ? { about: ctx.about } : {}),
  }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
const AUTHORS = ['Ananya S.', 'Rohit K.', 'Meera P.', 'Arjun N.']

/** The category's starter products (the ones a new store is seeded with) as a sample, until a generated one exists. */
export function starterSample(category: string | null | undefined): SampleCatalog | null {
  const seed = category ? SEED_CATALOGS[category] : null
  if (!seed) return null
  const cat = seed.categorySlug
  const products = seed.items.map((it, i) => ({
    slug: slug(it.name) || `item-${i + 1}`,
    name: it.name,
    price: it.price,
    mrp: i % 3 === 1 ? Math.round((it.price * 1.25) / 100) * 100 - 1 : null,
    category: cat,
    description: it.blurb,
    inStock: true,
    featured: i < 4,
    badge: i === 0 ? 'Bestseller' : i === 2 ? 'New' : null,
    images: [],
  }))
  return {
    store: { name: '' },
    categories: [{ slug: cat, name: seed.category, description: seed.hero[0]?.subtitle, parent: null, image: null }],
    brands: [],
    products,
    reviews: products.slice(0, 4).map((p, i) => ({ productSlug: p.slug, rating: i === 3 ? 4 : 5, title: null, comment: 'Just as described, and it arrived well packed.', author: AUTHORS[i] })),
    offers: seed.hero.map((h, i) => ({ slug: `offer-${i + 1}`, title: h.title, subtitle: h.subtitle, badge: h.badge, cta: h.cta, image: null, endsAt: null })),
  }
}

export type ThemeStudioResult = { ok: true; session: StudioSession } | { ok: false; status: number; error: string; code?: string }

/** The owner's studio, created on first use with the details the wizard already has; no AI runs. */
export async function openThemeStudio(ownerId: string, product: StudioProduct): Promise<ThemeStudioResult> {
  if (product === 'showcase') {
    const site = await ownerShowcase(ownerId)
    if (!site) return { ok: false, status: 409, error: 'Save your business details first.' }
    return { ok: true, session: await startShowcaseStudio(ownerId, site) }
  }
  let session = (await getStudioSession(ownerId, 'store')) ?? (await startStudioSession(ownerId, false, 'store'))
  if (!Object.keys(session.answers ?? {}).length) {
    const store = await studioStoreContext(ownerId)
    const answers = cleanAnswers({ sell: store.categories.join(', '), ...studioStoreAnswers(store) })
    session = (await updateStudioSession(session.id, { answers: answers as unknown as Record<string, unknown> })) ?? session
  }
  return { ok: true, session }
}

/** What the theme is filled with: the owner's details (and, for a store, its sample catalogue). */
async function themeOwner(session: StudioSession) {
  if (session.product === 'showcase') {
    const site = await ownerShowcase(session.owner_id)
    return { answers: { ...session.answers, ...(site ? detailsAnswers(site) : {}) }, category: site?.business.profession ?? null }
  }
  const ctx = await studioStoreContext(session.owner_id)
  const category = ctx.categories[0] ?? null
  return { answers: { ...session.answers, ...studioStoreAnswers(ctx) }, category, store: sampleStore(ctx), fallbackSample: starterSample(category) }
}

/**
 * The theme as the session's whole site: its pages, palette, direction, plan and (for a store) sample catalogue, and
 * the session ready, so the owner lands in the build step. A site already there is replaced only with `replace`.
 */
export async function applyTheme(session: StudioSession, themeId: unknown, opts: { replace?: boolean } = {}): Promise<ThemeStudioResult> {
  if (!parseThemeId(themeId)) return { ok: false, status: 400, error: 'Pick a theme.' }
  if (buildRunning(session)) return { ok: false, status: 409, error: 'Your site is being built. Wait for it to finish first.', code: 'running' }
  if (Object.keys(session.pages ?? {}).length && !opts.replace) return { ok: false, status: 409, error: 'You already have a site here. Applying a theme replaces it.', code: 'has_site' }
  const product: ThemeProduct = session.product === 'showcase' ? 'showcase' : 'store'
  const site = await themeSite(themeId, product, await themeOwner(session))
  if (!site) return { ok: false, status: 404, error: 'That theme is not ready yet. Pick another, or design your site with AI.', code: 'theme_unavailable' }
  const keys = Object.keys(site.pages)
  const saved = await updateStudioSession(session.id, {
    status: 'ready',
    brief: site.brief,
    plan: site.plan,
    directions: [site.direction],
    direction: site.direction,
    theme: site.theme,
    pages: site.pages,
    ...(product === 'store' ? { catalog: site.catalog } : {}),
    progress: { done: keys, failed: [], total: keys.length, message: `Made from the ${site.direction.name} theme`, at: new Date().toISOString() },
    error: null,
  })
  if (!saved) return { ok: false, status: 404, error: 'Start the studio first' }
  // A draft Showcase takes its new page at once, as after an AI design (the console can publish it); a live one when
  // the owner publishes.
  if (product === 'showcase') {
    const draft = await ownerShowcase(saved.owner_id).catch(() => null)
    if (draft?.status === 'draft') await copyStudioPage(draft, saved).catch(err => console.warn('[themes] showcase draft page not saved:', (err as Error).message))
  }
  return { ok: true, session: saved }
}

/**
 * The session as it would look in a theme, for the preview route before the owner applies it: the theme's pages
 * (only those the page shown needs), palette and, for a store, its sample catalogue. Null for an unknown theme.
 */
export async function themePreviewSession(session: StudioSession, themeId: unknown, key: string): Promise<StudioSession | null> {
  const t = parseThemeId(themeId)
  if (!t) return null
  const product: ThemeProduct = session.product === 'showcase' ? 'showcase' : 'store'
  const keys = product === 'showcase' ? [SHOWCASE_HOME] : [key, 'store:home', 'store:header', 'store:footer', 'store:announcement', 'store:card', 'store:products']
  const pages = await themePages(t.style, product, keys)
  if (!pages || !Object.keys(pages).length) return null
  const direction = themeDirection(t.style, t.palette)
  const preview: StudioSession = { ...session, pages, theme: themeTokens(t.style, t.palette), direction, plan: templateFile(t.style, product)?.plan ?? session.plan }
  if (product === 'store') {
    const ctx = await studioStoreContext(session.owner_id)
    const category = ctx.categories[0] ?? null
    preview.catalog = themeSample(category, sampleStore(ctx), starterSample(category))
  }
  return preview
}
