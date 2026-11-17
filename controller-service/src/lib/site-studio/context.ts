import 'server-only'
import { controlPlanePool, getDraft } from '@/lib/tenant-registry'
import type { SiteAudience } from '@jeffi/site-blocks'
import { cleanSocials, whatsappDigits, type StoreSocials } from '@/lib/catalog/store-socials'
import type { StudioContact } from '@/lib/site/studio/types'
import { getStudioSessionById, type StudioSession } from './sessions'

/** What the wizard already knows about the store, from the onboarding draft (Plan and Store steps). */
export interface StudioStoreContext {
  storeName: string
  categories: string[]
  logoUrl: string | null
  planSlug: string | null
  audiences: SiteAudience[]
  /** '' when the owner gave none. */
  tagline: string
  about: string
  /** How customers reach the store, as its site shows it. */
  contact: StudioContact
  socials: StoreSocials
}

// The business portal comes with Pro and Enterprise (PLAN_FEATURE_MATRIX.md).
const BUSINESS_PLANS = ['pro', 'enterprise']
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** The context from a draft's data (the autosave route has it in hand). */
export function studioStoreContextFrom(data: Record<string, any>): StudioStoreContext {
  const planSlug = typeof data.planSlug === 'string' ? data.planSlug : null
  const c = (data.contact && typeof data.contact === 'object' ? data.contact : {}) as Record<string, unknown>
  const phone = text(c.phone, 20)
  const email = text(c.email, 200)
  const line = text(c.address, 300)
  const whatsapp = whatsappDigits(c.whatsappSame ? c.phone : c.whatsapp) || ''
  const contact: StudioContact = {}
  if (/^\+?\d{8,15}$/.test(phone.replace(/[\s-]/g, ''))) contact.phone = phone
  if (whatsapp) contact.whatsapp = whatsapp
  if (EMAIL.test(email)) contact.email = email
  // Only with a street line, as the store's site_settings take it (provisioning/seed-settings.ts).
  if (line) contact.address = [line, text(c.city, 80), [text(c.state, 80), text(c.pincode, 10)].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return {
    storeName: String(data.displayName ?? '').trim().slice(0, 120) || 'Your store',
    categories: Array.isArray(data.productCats) ? data.productCats.map(String).slice(0, 12) : [],
    logoUrl: typeof data.logoUrl === 'string' && /^https:\/\//.test(data.logoUrl) ? data.logoUrl : null,
    planSlug,
    audiences: planSlug && BUSINESS_PLANS.includes(planSlug) ? ['store', 'business'] : ['store'],
    tagline: text(data.tagline, 120),
    about: text(data.about, 600),
    contact,
    socials: cleanSocials(data.socials),
  }
}

export async function studioStoreContext(ownerId: string): Promise<StudioStoreContext> {
  const data = ((await getDraft(ownerId).catch(() => null))?.data ?? {}) as Record<string, any>
  return studioStoreContextFrom(data)
}

/** The Store step's fields as the studio's answers keep them (storeName only once the owner named the store). */
export function studioStoreAnswers(ctx: StudioStoreContext): Record<string, unknown> {
  return {
    ...(ctx.storeName !== 'Your store' ? { storeName: ctx.storeName.slice(0, 80) } : {}),
    logoUrl: ctx.logoUrl,
    ...(ctx.tagline ? { tagline: ctx.tagline } : {}),
    ...(ctx.about ? { about: ctx.about } : {}),
    ...(Object.keys(ctx.contact).length ? { contact: ctx.contact } : {}),
    ...(Object.keys(ctx.socials).length ? { socials: ctx.socials } : {}),
  }
}

const stable = (v: unknown): string =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? `{${Object.keys(v as object)
        .sort()
        .map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
        .join(',')}}`
    : JSON.stringify(v ?? null)

const pick = (o: unknown, keys: string[]) =>
  Object.fromEntries(keys.map(k => [k, (o as Record<string, unknown> | null)?.[k]]).filter(([, v]) => v !== undefined && v !== null && v !== ''))

/**
 * Brings the owner's studio up to date with the Store step: the answers, the brief and the sample store the preview
 * shows (name, logo, contacts, socials, and the tagline and story when given). Only JSON is rewritten, no AI runs and
 * no page changes. The sample store is patched in place, so a build saving product photos meanwhile keeps them.
 */
export async function syncStudioStore(session: StudioSession, ctx: StudioStoreContext): Promise<StudioSession> {
  const answers = studioStoreAnswers(ctx)
  const answerKeys = ['logoUrl', 'tagline', 'about', 'contact', 'socials', ...('storeName' in answers ? ['storeName'] : [])]
  const store: Record<string, unknown> = {
    name: ctx.storeName,
    logo: ctx.logoUrl,
    email: ctx.contact.email ?? '',
    phone: ctx.contact.phone ?? '',
    address: ctx.contact.address ?? '',
    ...(ctx.contact.whatsapp ? { whatsapp: ctx.contact.whatsapp } : {}),
    ...(Object.keys(ctx.socials).length ? { socials: ctx.socials } : {}),
    // Without the owner's own, the sample keeps the AI's.
    ...(ctx.tagline ? { tagline: ctx.tagline } : {}),
    ...(ctx.about ? { about: ctx.about } : {}),
  }
  const storeKeys = ['name', 'logo', 'email', 'phone', 'address', 'whatsapp', 'socials', ...(ctx.tagline ? ['tagline'] : []), ...(ctx.about ? ['about'] : [])]
  const same = (current: unknown, want: Record<string, unknown>, keys: string[]) => stable(pick(current, keys)) === stable(pick(want, keys))
  const catalogStore = (session.catalog as { store?: unknown } | null)?.store ?? {}
  const answersStale = Object.keys(session.answers ?? {}).length > 0 && !same(session.answers, answers, answerKeys)
  const briefStale = !!session.brief && !same(session.brief, answers, answerKeys)
  const storeStale = !!session.catalog && !same(catalogStore, store, storeKeys)
  if (!answersStale && !briefStale && !storeStale) return session

  await controlPlanePool().query(
    `UPDATE site_studio_sessions SET
       answers = CASE WHEN $2 THEN (answers - $5::text[]) || $6::jsonb ELSE answers END,
       brief = CASE WHEN $3 THEN (brief - $5::text[]) || $6::jsonb ELSE brief END,
       catalog = CASE WHEN $4 THEN jsonb_set(catalog, '{store}', (COALESCE(catalog->'store', '{}'::jsonb) - $7::text[]) || $8::jsonb) ELSE catalog END
     WHERE id = $1`,
    [session.id, answersStale, briefStale, storeStale, answerKeys, JSON.stringify(answers), storeKeys, JSON.stringify(store)]
  )
  return (await getStudioSessionById(session.id)) ?? session
}
