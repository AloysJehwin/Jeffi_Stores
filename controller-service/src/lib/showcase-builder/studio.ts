import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { cleanAnswers } from '@/lib/site/studio'
import { businessView } from '@/lib/showcase/views'
import type { ShowcaseSiteRow } from '@/lib/showcase/store'
import { studioAiAvailable, studioView } from '@controller/lib/site-studio/http'
import { getStudioSession, getStudioSessionById, startStudioSession, updateStudioSession, type StudioSession } from '@controller/lib/site-studio/sessions'
import { ownerShowcase, siteForClient } from './site'

// The Showcase's studio (site_studio_sessions, product 'showcase'): its brief starts from the Details step, and keeps
// the business's name, logo, tagline, story, contacts and socials as the owner changes them (no AI runs for that).

const KEYS = ['storeName', 'logoUrl', 'tagline', 'about', 'contact', 'socials']

/** The Details as the studio's answers keep them. */
export function detailsAnswers(site: Pick<ShowcaseSiteRow, 'business'>): Record<string, unknown> {
  const b = site.business
  const v = businessView(b)
  const contact = Object.fromEntries(
    Object.entries({ phone: v.phone, whatsapp: v.whatsapp, email: v.email, address: v.fullAddress }).filter(([, x]) => x)
  )
  return {
    storeName: v.name.slice(0, 80),
    logoUrl: v.logo,
    ...(v.tagline ? { tagline: v.tagline.slice(0, 120) } : {}),
    ...(v.about ? { about: v.about.slice(0, 600) } : {}),
    ...(Object.keys(contact).length ? { contact } : {}),
    ...(v.socials.length ? { socials: Object.fromEntries(v.socials.map(s => [s.network, s.href])) } : {}),
  }
}

/** "What do you do?" to start from: the profession and the services the owner wrote (not the AI's suggestions). */
export function whatTheyDo(site: Pick<ShowcaseSiteRow, 'business' | 'content'>): string {
  const services = (site.content.services ?? []).filter(s => !s.ai).map(s => s.title).filter(Boolean).slice(0, 8)
  const what = (site.business.profession ?? '').trim()
  return [what, services.length ? `${what ? 'Services' : 'We offer'}: ${services.join(', ')}` : ''].filter(Boolean).join('. ').slice(0, 1200)
}

/** The owner's Showcase studio, opened (or, with `restart`, cleared back to the brief) with the Details filled in. */
export async function startShowcaseStudio(ownerId: string, site: ShowcaseSiteRow, restart = false): Promise<StudioSession> {
  const session = await startStudioSession(ownerId, restart, 'showcase')
  if (Object.keys(session.answers ?? {}).length) return session
  const answers = cleanAnswers({ sell: whatTheyDo(site), ...detailsAnswers(site) })
  return (await updateStudioSession(session.id, { answers: answers as unknown as Record<string, unknown> })) ?? session
}

const stable = (v: unknown): string =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? `{${Object.keys(v as object)
        .sort()
        .map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
        .join(',')}}`
    : JSON.stringify(v ?? null)
const pick = (o: unknown) => Object.fromEntries(KEYS.map(k => [k, (o as Record<string, unknown> | null)?.[k]]).filter(([, v]) => v !== undefined && v !== null && v !== ''))

/** Brings the studio's answers and brief up to date with the Details (JSON only: no AI, no page changes). */
export async function syncShowcaseStudio(session: StudioSession, site: ShowcaseSiteRow): Promise<StudioSession> {
  const want = cleanAnswers({ sell: 'x', ...detailsAnswers(site) }) as unknown as Record<string, unknown>
  const patch = pick(want)
  const answersStale = Object.keys(session.answers ?? {}).length > 0 && stable(pick(session.answers)) !== stable(patch)
  const briefStale = !!session.brief && stable(pick(session.brief)) !== stable(patch)
  if (!answersStale && !briefStale) return session
  await controlPlanePool().query(
    `UPDATE site_studio_sessions SET
       answers = CASE WHEN $2 THEN (answers - $4::text[]) || $5::jsonb ELSE answers END,
       brief = CASE WHEN $3 THEN (brief - $4::text[]) || $5::jsonb ELSE brief END
     WHERE id = $1 AND product = 'showcase'`,
    [session.id, answersStale, briefStale, KEYS, JSON.stringify(patch)]
  )
  return (await getStudioSessionById(session.id)) ?? session
}

/** What the Showcase's studio shows: the session (kept in step with the Details), the site, and whether AI is up. */
export async function showcaseStudioState(ownerId: string, opts: { fresh?: boolean } = {}) {
  const [session, site, available] = await Promise.all([getStudioSession(ownerId, 'showcase'), ownerShowcase(ownerId), studioAiAvailable({ fresh: opts.fresh })])
  const current = session && site ? await syncShowcaseStudio(session, site).catch(() => session) : session
  return { ...studioView(current), site: siteForClient(site), ai: { available } }
}
