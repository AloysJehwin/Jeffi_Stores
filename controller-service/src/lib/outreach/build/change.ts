import type { Block, PageDoc } from '@jeffi/site-blocks'
import { runStudioWithModel, tweakSection } from '@/lib/site/studio'
import { askJson } from '@/lib/site/studio/ai'
import { getShowcaseById, type ShowcaseSiteRow } from '@/lib/showcase/store'
import { SHOWCASE_PAGE_KEY } from '@/lib/showcase/types'
import { parseThemeId } from '@/lib/site/themes/catalog'
import { studioCtx } from '@controller/lib/site-studio/build'
import { funded } from '@controller/lib/site-studio/funded'
import { BUDGET_INR } from '@controller/lib/site-studio/allowance'
import { claimRebuild, saveStudioPage, settleRebuild, updateStudioSession, type StudioSession } from '@controller/lib/site-studio/sessions'
import { recordEvent } from '../events'
import { briefHash, mergeBriefs, readBrief, readyToBuild } from './brief'
import { outreachModel, pushPage, startRun } from './run'
import { directionOf, namesColourOrLook, pickTheme, wornTheme } from './sketch'
import { isRunning, MAX_BUILDS, planRun, readBuild, withContact, writeExtra } from './state'

// A change asked for on the call, through the studio's own revise paths: one section rewritten as asked (the studio's
// tweak), the colours or look swapped for another theme palette (no AI, instant), or, for the whole page, folded into
// the brief and designed again by the next generation. Platform-funded, never the owner's corrections allowance.

export type ChangeResult = { ok: boolean; summary: string }
type Route = { target: 'section'; id: string; label: string } | { target: 'colours' } | { target: 'page' }

/** How long requestChange waits for a section change before saying it is on its way. */
export const CHANGE_WAIT_MS = 15_000

const errText = (err: unknown) => ((err as Error)?.message || 'unknown error').slice(0, 300)
const SORRY: ChangeResult = { ok: false, summary: "I couldn't make that change just now. Could you say it another way?" }

// Words an owner uses for a section, matched against the section's label when the AI can't route the change.
const SECTION_WORDS: [RegExp, RegExp][] = [
  [/\b(header|menu bar|logo|top bar|navigation)\b/i, /header|nav|top bar/i],
  [/\b(headline|heading|banner|hero|first part|top of the page|main picture)\b/i, /hero|opening|welcome|intro|banner/i],
  [/\b(about|story|who we are)\b/i, /about|story/i],
  [/\b(services?|menu|prices?|offerings?|packages?)\b/i, /service|menu|offer|price|package/i],
  [/\b(gallery|photos?|pictures?|work|portfolio)\b/i, /work|gallery|portfolio|photo/i],
  [/\b(reviews?|testimonials?|what (clients|customers) say)\b/i, /review|testimonial|say|client|praise/i],
  [/\b(faqs?|questions?)\b/i, /faq|question/i],
  [/\b(contact|form|enquir(y|ies)|map|reach us)\b/i, /contact|enquir|reach|touch|book|visit/i],
  [/\b(footer|bottom)\b/i, /footer/i],
]

export function routeByWords(sections: { id: string; label: string }[], text: string): Route {
  for (const [asked, label] of SECTION_WORDS) {
    if (!asked.test(text)) continue
    const s = sections.find(x => label.test(x.label))
    if (s) return { target: 'section', ...s }
  }
  const named = sections.find(x => x.label.split(/\W+/).some(w => w.length >= 4 && new RegExp(`\\b${w}\\b`, 'i').test(text)))
  if (named) return { target: 'section', ...named }
  if (namesColourOrLook(text) || /\b(colou?rs?|theme|palette|shade)\b/i.test(text)) return { target: 'colours' }
  return { target: 'page' }
}

async function route(session: StudioSession, doc: PageDoc, text: string): Promise<Route> {
  const sections = doc.order.map(id => ({ id, label: String(doc.blocks[id]?.props?.label ?? 'Section') }))
  const out = await funded(session.id, BUDGET_INR.small, () =>
    askJson<{ target?: unknown; section?: unknown }>(
      `You route a business owner's spoken change request for their one-page website. Its sections, top to bottom:
${sections.map((s, i) => `${i}. ${s.label}`).join('\n')}
Return JSON {"target": "section" | "colours" | "page", "section": the section's number or null}. "colours" when they only want other colours or another overall look; "section" when one section fits; "page" when it is about the whole page or no single section fits.`,
      text,
      { maxTokens: 120, temperature: 0, modelHint: 'copy' }
    )
  ).catch(() => null)
  const n = Number(out?.section)
  if (out?.target === 'section' && Number.isInteger(n) && sections[n]) return { target: 'section', ...sections[n] }
  if (out?.target === 'colours') return { target: 'colours' }
  if (out?.target === 'page') return { target: 'page' }
  return routeByWords(sections, text)
}

/** The change kept in the brief for the next generation (started or queued now when the brief is ready). */
export async function noteChange(contactId: string, text: string): Promise<ChangeResult> {
  const r = await withContact(contactId, async (c, tx) => {
    const brief = mergeBriefs(readBrief(c.extra), { changes: [text] })
    const build = readBuild(c.extra)
    const plan = readyToBuild(brief) ? planRun(build, briefHash(brief)) : { action: 'none' as const, next: build }
    await writeExtra(tx, c.id, { brief, build: plan.next })
    if (plan.action !== 'none') await recordEvent(c.id, plan.action === 'start' ? 'build_started' : 'build_queued', { actor: 'build', data: { build: plan.next.builds, change: true } }, tx)
    return { ready: readyToBuild(brief), plan }
  })
  if (r.plan.action === 'start') startRun(contactId, r.plan.next.runId!)
  if (!r.ready) return { ok: true, summary: "Noted. I'll put that in when I design the full site." }
  if (r.plan.action !== 'none' || isRunning(r.plan.next)) return { ok: true, summary: "Got it. I'm working that into the design now; it will show on your preview in a couple of minutes." }
  if (r.plan.next.builds >= MAX_BUILDS) return { ok: false, summary: "I can't redesign the whole page again on this call. Once the site is yours you can change anything from your dashboard." }
  return { ok: true, summary: "Noted. I'll put that in the next version of your page." }
}

/** Another palette (or look) for the page: the theme changes, the sections stay. */
async function recolour(contactId: string, site: ShowcaseSiteRow, session: StudioSession, text: string): Promise<ChangeResult | null> {
  const worn = wornTheme(session.direction)
  const want = pickTheme(text, contactId, worn)
  if (want === worn) return null
  const direction = directionOf(want)
  const saved = await updateStudioSession(session.id, { direction, theme: direction.theme })
  await pushPage((await getShowcaseById(site.id)) ?? site, saved)
  // The brief remembers the look, so a later generation keeps it; that alone needs no new design.
  await withContact(contactId, async (c, tx) => {
    const before = readBrief(c.extra)
    const brief = mergeBriefs(before, { style: text })
    const build = readBuild(c.extra)
    const settled = build.hash === briefHash(before) && !isRunning(build)
    await writeExtra(tx, c.id, { brief, ...(settled ? { build: { ...build, hash: briefHash(brief) } } : {}) })
  })
  await recordEvent(contactId, 'change_applied', { actor: 'build', data: { theme: want } })
  return { ok: true, summary: `Done. I've changed the colours to ${parseThemeId(want)?.palette.name ?? 'a new palette'}. Have a look at your preview.` }
}

/** One section rewritten as asked, saved and put on the site. */
async function rewrite(contactId: string, site: ShowcaseSiteRow, claimed: StudioSession, doc: PageDoc, id: string, label: string, text: string): Promise<boolean> {
  const t0 = Date.now()
  try {
    const block = doc.blocks[id] as Block
    await runStudioWithModel(outreachModel(), () =>
      funded(claimed.id, BUDGET_INR.small, async () => {
        const next = await tweakSection(studioCtx(claimed), block, text, SHOWCASE_PAGE_KEY)
        await saveStudioPage(claimed.id, SHOWCASE_PAGE_KEY, { ...doc, blocks: { ...doc.blocks, [id]: { ...next, id, ...(block.visibility ? { visibility: block.visibility } : {}) } } })
      })
    )
    const after = await settleRebuild(claimed.id)
    await pushPage((await getShowcaseById(site.id)) ?? site, after)
    await recordEvent(contactId, 'change_applied', { actor: 'build', data: { section: label, ms: Date.now() - t0 } })
    return true
  } catch (err) {
    await settleRebuild(claimed.id).catch(() => null)
    await recordEvent(contactId, 'change_failed', { actor: 'build', data: { section: label, error: errText(err) } }).catch(() => {})
    return false
  }
}

/** A change on a designed page (no generation running). */
export async function applyChange(contactId: string, site: ShowcaseSiteRow, session: StudioSession, text: string): Promise<ChangeResult> {
  const doc = session.pages?.[SHOWCASE_PAGE_KEY]
  if (!doc?.order.length) return noteChange(contactId, text)
  const r = await route(session, doc, text)
  if (r.target === 'colours') return (await recolour(contactId, site, session, text)) ?? noteChange(contactId, text)
  if (r.target === 'page') return noteChange(contactId, text)
  const claimed = await claimRebuild(session.id)
  if (!claimed) return noteChange(contactId, text)
  const label = r.label.toLowerCase().replace(/^(our|your|the)\s+/, '')
  const work = rewrite(contactId, site, claimed, (claimed.pages?.[SHOWCASE_PAGE_KEY] as PageDoc | undefined) ?? doc, r.id, r.label, text)
  let timer: ReturnType<typeof setTimeout> | undefined
  const done = await Promise.race([work, new Promise<'pending'>(res => (timer = setTimeout(() => res('pending'), CHANGE_WAIT_MS)))])
  clearTimeout(timer)
  if (done === 'pending') return { ok: true, summary: `I'm changing the ${label} section now. It will show on your preview in a few seconds.` }
  return done ? { ok: true, summary: `Done. I've updated the ${label} section; it's on your preview now.` } : SORRY
}

export { SORRY }
