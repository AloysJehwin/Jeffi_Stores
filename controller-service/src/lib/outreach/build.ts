import { cleanBusiness } from '@/lib/showcase/clean'
import { mintPreview } from '@/lib/showcase/preview-token'
import { getShowcaseById, updateShowcase, type ShowcaseSiteRow } from '@/lib/showcase/store'
import { publishOwnerShowcase } from '@controller/lib/showcase-builder/publish'
import { syncShowcaseStudio } from '@controller/lib/showcase-builder/studio'
import { applyTheme } from '@controller/lib/site-studio/themes'
import { buildRunning, getStudioSession } from '@controller/lib/site-studio/sessions'
import { createClaimToken, ensureOutreachSystemOwner } from './claim'
import { getContact } from './contacts'
import { recordEvent } from './events'
import { canTransition, transition } from './state'
import type { ContactStatus, OutreachContact } from './types'
import { briefHash, businessWith, mergeBriefs, missingOf, readBrief, readyToBuild, type OutreachBrief, type StoredBrief } from './build/brief'
import { isRunning, planRun, readBuild, withContact, writeExtra, type BuildState } from './build/state'
import { applySketch, createOutreachDraft, pickTheme, wornTheme } from './build/sketch'
import { startRun } from './build/run'
import { applyChange, noteChange, SORRY } from './build/change'

// The in-call Showcase build (OUTREACH_AND_ECOM_ADS_PLAN.md §2–3), behind the call tools and the WhatsApp bot:
//   startDraft    a draft held by the outreach owner, wearing a ready-made theme at once (the sketch), and its preview link
//   mergeBrief    the progressive brief (outreach_contacts.extra.brief); the sketch's details follow it at once, and the
//                 full generation starts in the background once the brief is enough (build/run.ts)
//   requestChange a change through the studio's revise paths (build/change.ts)
//   publish       live (the 7-day trial starts, preview links drop to 30 minutes) plus a claim link
// Generation state is extra.build (build/state.ts). Nothing here sends a message.

export type { OutreachBrief } from './build/brief'

export type OutreachBuildCode = 'no_contact' | 'opted_out' | 'no_site' | 'not_built' | 'building' | 'details' | 'claimed' | 'publish_failed'

/** A refusal the caller can say as it is. */
export class OutreachBuildError extends Error {
  constructor(
    readonly code: OutreachBuildCode,
    message: string
  ) {
    super(message)
    this.name = 'OutreachBuildError'
  }
}

const errText = (err: unknown) => ((err as Error)?.message || 'unknown error').slice(0, 300)

/** The contact's status moved on (a contact still in its call goes through interested); never fails the build. */
async function advance(c: Pick<OutreachContact, 'id' | 'status'>, to: ContactStatus, data: Record<string, unknown>): Promise<void> {
  try {
    if (c.status === to) return
    if (!canTransition(c.status, to)) {
      if (!(c.status === 'calling' && canTransition('interested', to))) return
      await transition(c, 'interested', { actor: 'build', data })
    }
    await transition(c, to, { actor: 'build', data })
  } catch (err) {
    console.warn(`[outreach-build] status ${to} not set for ${c.id}: ${errText(err)}`)
  }
}

const STOPPED: ContactStatus[] = ['opted_out', 'suppressed', 'dnd']

/** The contact, unless it is unknown or asked not to be contacted (nothing is built for those). */
async function contactOrThrow(contactId: string): Promise<OutreachContact> {
  const c = await getContact(contactId).catch(() => null)
  if (!c) throw new OutreachBuildError('no_contact', 'I could not find this business in our list.')
  if (c.opted_out_at || STOPPED.includes(c.status)) throw new OutreachBuildError('opted_out', 'This business asked us not to contact them, so nothing more is built.')
  return c
}

export async function startDraft(contactId: string, input: { businessName: string; language: string }): Promise<{ siteId: string; previewUrl: string }> {
  const t0 = Date.now()
  await contactOrThrow(contactId)
  const owner = await ensureOutreachSystemOwner()
  const name = cleanBusiness({ name: input.businessName }).name
  const made = await withContact(contactId, async (c, tx) => {
    const existing = c.showcase_site_id ? await getShowcaseById(c.showcase_site_id) : null
    if (existing) return { site: existing, created: false, contact: c }
    const business = cleanBusiness({ name: name || c.business_name, profession: c.category ?? '', city: c.city ?? '' })
    if (business.name.length < 2) throw new OutreachBuildError('details', 'I need the name of the business to start the site.')
    const site = await createOutreachDraft(owner.id, business, c.city)
    await writeExtra(tx, c.id, { build: { ...readBuild(c.extra), callLanguage: input.language } }, { showcaseSiteId: site.id })
    return { site, created: true, contact: c }
  })
  let site: ShowcaseSiteRow = made.site
  const ours = site.ownerId === owner.id
  if (ours && !made.created && name.length >= 2 && name !== site.business.name) site = (await updateShowcase(site.id, { business: { ...site.business, name } })) ?? site
  // The sketch: new, or one that never landed (a crash between the draft and its theme).
  let theme: string | null = null
  if (ours && !site.page) {
    theme = await applySketch(owner.id, site, pickTheme(readBrief(made.contact.extra).style, contactId)).catch(err => {
      console.warn(`[outreach-build] sketch failed for ${contactId}: ${errText(err)}`)
      return null
    })
    if (!theme) await recordEvent(contactId, 'sketch_failed', { actor: 'build', data: { site_id: site.id } }).catch(() => {})
  }
  const preview = await mintPreview(site.id)
  if (!preview) throw new OutreachBuildError('no_site', 'The site could not be found.')
  // The admin contact page reads the links from the events (contacts have no URL columns).
  if (made.created) {
    await recordEvent(contactId, 'draft_started', { actor: 'build', data: { site_id: site.id, slug: site.slug, theme, ms: Date.now() - t0, previewUrl: preview.url, expiresAt: preview.expiresAt } })
    await advance(made.contact, 'building', { site_id: site.id })
  } else await recordEvent(contactId, 'preview_link', { actor: 'build', data: { site_id: site.id, previewUrl: preview.url, expiresAt: preview.expiresAt } })
  return { siteId: site.id, previewUrl: preview.url }
}

/** The sketch follows the brief: details (shown live by the page), the studio's answers, and the look before the full design. */
async function updateSketch(c: OutreachContact, brief: StoredBrief, build: BuildState): Promise<void> {
  const site = c.showcase_site_id ? await getShowcaseById(c.showcase_site_id) : null
  if (!site || site.ownerId !== (await ensureOutreachSystemOwner()).id) return
  const business = businessWith(site.business, brief)
  const fresh = JSON.stringify(business) === JSON.stringify(site.business) ? site : ((await updateShowcase(site.id, { business })) ?? site)
  const session = await getStudioSession(site.ownerId, 'showcase', site.id)
  if (!session) return
  const synced = await syncShowcaseStudio(session, fresh)
  if (!brief.style || build.builtAt || isRunning(build) || buildRunning(synced)) return
  const worn = wornTheme(synced.direction)
  const want = pickTheme(brief.style, c.id, worn)
  if (want !== worn) await applyTheme(synced, want, { replace: true })
}

export async function mergeBrief(contactId: string, partial: OutreachBrief): Promise<{ building: boolean; missing: (keyof OutreachBrief)[] }> {
  const contact = await contactOrThrow(contactId)
  if (!contact.showcase_site_id) await startDraft(contactId, { businessName: contact.business_name, language: contact.language ?? 'en' })
  const given = Object.keys(partial ?? {}).filter(k => (partial as Record<string, unknown>)[k] != null)
  const r = await withContact(contactId, async (c, tx) => {
    const brief = mergeBriefs(readBrief(c.extra), partial ?? {})
    const build = readBuild(c.extra)
    const plan = readyToBuild(brief) ? planRun(build, briefHash(brief)) : { action: 'none' as const, next: build }
    await writeExtra(tx, c.id, { brief, build: plan.next })
    await recordEvent(c.id, 'brief_updated', { actor: 'build', data: { keys: given } }, tx)
    if (plan.action !== 'none') await recordEvent(c.id, plan.action === 'start' ? 'build_started' : 'build_queued', { actor: 'build', data: { build: plan.next.builds } }, tx)
    return { contact: c, brief, plan }
  })
  await updateSketch(r.contact, r.brief, r.plan.next).catch(err => console.warn(`[outreach-build] sketch not updated for ${contactId}: ${errText(err)}`))
  if (r.plan.action === 'start') startRun(contactId, r.plan.next.runId!)
  return { building: isRunning(r.plan.next), missing: missingOf(r.brief) }
}

export async function requestChange(contactId: string, instruction: string): Promise<{ ok: boolean; summary: string }> {
  const text = (typeof instruction === 'string' ? instruction : '').replace(/\s+/g, ' ').trim().slice(0, 300)
  if (text.length < 3) return { ok: false, summary: 'What would you like me to change on the site?' }
  try {
    const contact = await getContact(contactId)
    if (contact && (contact.opted_out_at || STOPPED.includes(contact.status))) return { ok: false, summary: 'Nothing more can be changed for this business.' }
    const site = contact?.showcase_site_id ? await getShowcaseById(contact.showcase_site_id) : null
    if (!contact || !site) return { ok: false, summary: "I haven't started your site yet. Let me do that first." }
    const owner = await ensureOutreachSystemOwner()
    if (site.ownerId !== owner.id) return { ok: false, summary: 'The site is yours now, so you can change it from your dashboard.' }
    await recordEvent(contactId, 'change_requested', { actor: 'build', data: { instruction: text } })
    const build = readBuild(contact.extra)
    const session = await getStudioSession(owner.id, 'showcase', site.id)
    // Before the full design, or while one runs, the change goes into it.
    if (!build.builtAt || isRunning(build) || !session || buildRunning(session)) return await noteChange(contactId, text)
    return await applyChange(contactId, site, session, text)
  } catch (err) {
    console.warn(`[outreach-build] change failed for ${contactId}: ${errText(err)}`)
    await recordEvent(contactId, 'change_failed', { actor: 'build', data: { error: errText(err) } }).catch(() => {})
    return SORRY
  }
}

export async function publish(contactId: string): Promise<{ liveUrl: string; claimUrl: string }> {
  const contact = await contactOrThrow(contactId)
  const site = contact.showcase_site_id ? await getShowcaseById(contact.showcase_site_id) : null
  if (!site) throw new OutreachBuildError('no_site', "There's no site to publish yet.")
  if (contact.status === 'claimed') throw new OutreachBuildError('claimed', 'The site has already been claimed by its owner.')
  const build = readBuild(contact.extra)
  if (!build.builtAt)
    throw isRunning(build)
      ? new OutreachBuildError('building', "Your site is still being designed. It'll be ready in a minute or two.")
      : new OutreachBuildError('not_built', "Your site isn't designed yet. I need a little more about your business first.")
  const owner = await ensureOutreachSystemOwner()
  const r = await publishOwnerShowcase(owner.id, site.id)
  if (!r.ok) {
    if (r.code === 'details') throw new OutreachBuildError('details', 'Before it goes live I need a phone number, WhatsApp number or email for the site.')
    if (r.code === 'running') throw new OutreachBuildError('building', "I'm just finishing an update to your site. Give me a minute and I'll publish it.")
    if (r.status === 404) throw new OutreachBuildError('claimed', 'The site has already been claimed by its owner.')
    throw new OutreachBuildError('publish_failed', "The site couldn't go live just now. Let me try again in a moment.")
  }
  const claim = await createClaimToken(contactId)
  if (!claim) throw new OutreachBuildError('claimed', 'The site has already been claimed by its owner.')
  await recordEvent(contactId, 'published', {
    actor: 'build',
    data: { site_id: site.id, slug: r.site.slug, first: r.first, trial_ends_at: r.site.trialEndsAt, liveUrl: r.url, claimLinkCreated: true, claimExpiresAt: claim.expiresAt },
  })
  await advance(contact, 'published', { site_id: site.id })
  return { liveUrl: r.url, claimUrl: claim.url }
}
