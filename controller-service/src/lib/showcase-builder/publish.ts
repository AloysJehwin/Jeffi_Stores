import 'server-only'
import { normalizeTheme, validateDoc, type PageDoc } from '@jeffi/site-blocks'
import { CodeSectionInvalid, recompileCodeSections } from '@/lib/site/code/compile'
import { siteRegistry } from '@/lib/site/blocks'
import { publishShowcase, updateShowcase, type ShowcaseSiteRow } from '@/lib/showcase/store'
import { showcaseUrl } from '@/lib/showcase/host'
import { businessIssues } from '@/lib/showcase/clean'
import { SHOWCASE_PAGE_KEY } from '@/lib/showcase/types'
import { goLiveShowcase } from '@controller/lib/showcase/billing'
import { buildRunning, getStudioSession, type StudioSession } from '@controller/lib/site-studio/sessions'
import { ownedShowcase } from './site'

// Publishing a Showcase: the studio's page (recompiled from source: stored ASTs are never trusted) and its look are
// copied onto the site row, which showcase-service serves, then the site goes live (lib/showcase/store.ts
// publishShowcase: the first publish starts the trial; a paused, unpaid one goes on the subscription first, as the
// console's Publish does). Publishing a live site again is how design changes reach it; the details and content are
// read live from the row already.

export type PublishResult =
  | { ok: true; site: ShowcaseSiteRow; url: string; first: boolean }
  | { ok: false; status: number; error: string; code?: string; checkoutUrl?: string }

/** The page as it goes live: every code section compiled again for the Showcase page; one that no longer compiles is left out. */
async function livePage(doc: PageDoc): Promise<PageDoc> {
  const compile = (d: PageDoc) => recompileCodeSections(d, { page: 'showcase', coreType: null })
  let page: PageDoc
  try {
    page = await compile(doc)
  } catch (err) {
    const bad = err instanceof CodeSectionInvalid ? new Set(err.issues.map(i => i.blockId).filter(Boolean)) : null
    if (!bad?.size) throw err
    page = await compile({ ...doc, blocks: Object.fromEntries(Object.entries(doc.blocks).filter(([id]) => !bad.has(id))), order: doc.order.filter(id => !bad.has(id)) })
  }
  return validateDoc(page, siteRegistry, { audience: 'store', surface: 'web', page: 'showcase' }).doc
}

/** The studio's page and look onto the site row; false when the studio has no page or it no longer compiles. */
export async function copyStudioPage(site: Pick<ShowcaseSiteRow, 'id' | 'theme'>, session: StudioSession): Promise<boolean> {
  const doc = session.pages?.[SHOWCASE_PAGE_KEY]
  if (!doc) return false
  const page = await livePage(doc).catch(err => {
    console.error('[showcase] page did not compile:', (err as Error).message)
    return null
  })
  if (!page?.order.length) return false
  const theme = normalizeTheme(session.theme ?? (session.direction as { theme?: object } | null)?.theme ?? site.theme ?? null)
  await updateShowcase(site.id, { page, theme })
  return true
}

export async function publishOwnerShowcase(ownerId: string, siteId: unknown): Promise<PublishResult> {
  const site = await ownedShowcase(ownerId, siteId)
  if (!site) return { ok: false, status: 404, error: 'That site could not be found. Save your business details first.' }
  const issues = businessIssues(site.business)
  if (issues.length) return { ok: false, status: 400, error: issues[0], code: 'details' }
  const session = await getStudioSession(ownerId, 'showcase', site.id)
  if (session && buildRunning(session)) return { ok: false, status: 409, error: 'Your page is being designed. Publish when it is ready.', code: 'running' }
  if (session?.pages?.[SHOWCASE_PAGE_KEY]) {
    if (!(await copyStudioPage(site, session)))
      return { ok: false, status: 422, error: 'Your page could not be prepared to go live. Change the section that fails, or design the page again.' }
  } else if (!site.page) return { ok: false, status: 409, error: 'Design your page first.', code: 'no_page' }

  const first = site.status === 'draft'
  const r = await publishShowcase(site.id)
  if (r.ok) return { ok: true, site: r.site, url: showcaseUrl(r.site.slug), first }
  if (r.code !== 'payment_due') return { ok: false, status: r.code === 'not_found' ? 404 : 409, error: r.error, code: r.code }
  const live = await goLiveShowcase(site.id)
  if (live.ok) return { ok: true, site: live.site, url: showcaseUrl(live.site.slug), first }
  if (live.code === 'checkout') return { ok: false, status: 402, error: live.error, code: 'checkout', ...(live.checkoutUrl ? { checkoutUrl: live.checkoutUrl } : {}) }
  if (live.code === 'no_wallet') return { ok: false, status: 402, error: live.error, code: live.code }
  return { ok: false, status: live.code === 'not_found' ? 404 : 409, error: live.error, code: live.code }
}
