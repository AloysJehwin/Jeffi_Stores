import type { NextRequest } from 'next/server'
import { isPageKey, type PageDoc, type PageKey, type PageRef, type SiteAudience, type ThemeTokens } from '@jeffi/site-blocks'
import { CodeSectionInvalid, recompileCodeSections } from '../code/compile'
import { createSiteDraft, importLegacyLayouts, publishSiteDraft, saveDraftPage, saveDraftTheme, setSiteBuilderEnabled } from '../store'
import { afterSiteChange } from '../after-publish'
import { saveStudioContext } from './context'
import type { StudioSiteInput } from './types'

// Installs a studio session's site into the store: every page's code sections recompiled from source (stored ASTs are
// never trusted), saved into a new draft for desktop and phone, the theme for both audiences, then published with
// Site Builder switched on and the storefront refreshed. Pages that fail validation are skipped, not fatal.

// The listing design serves category and brand pages too, unless the session has its own for them.
const ALSO: Partial<Record<PageKey, PageKey[]>> = { products: ['category', 'brand'] }
const CHROME = new Set<PageKey>(['header', 'footer', 'announcement'])

/** `store:home`, `business:catalog`, a bare page key (store) or a full page ref key, as audience + page. */
export function parseStudioKey(key: string): { audience: SiteAudience; page: PageKey } | null {
  const parts = key.split(':')
  if (parts.length === 1) return isPageKey(parts[0]) ? { audience: 'store', page: parts[0] } : null
  const audience = parts[0] === 'business' ? 'business' : parts[0] === 'store' ? 'store' : null
  const page = parts.length >= 3 ? parts[2] : parts[1]
  return audience && isPageKey(page) ? { audience, page } : null
}

/** The doc recompiled for its page; sections that no longer compile are dropped, then the page rules must hold. */
async function recompiled(doc: PageDoc, page: PageKey): Promise<PageDoc> {
  try {
    return await recompileCodeSections(doc, { page, coreType: null })
  } catch (err) {
    const bad = err instanceof CodeSectionInvalid ? new Set(err.issues.map(i => i.blockId).filter(Boolean)) : null
    if (!bad?.size) throw err
    return recompileCodeSections({ ...doc, blocks: Object.fromEntries(Object.entries(doc.blocks).filter(([id]) => !bad.has(id))), order: doc.order.filter(id => !bad.has(id)) }, { page, coreType: null })
  }
}

export interface InstallResult {
  draftId: string
  /** Pages installed (each on desktop and phone). */
  pages: number
  skipped: { key: string; reason: string }[]
  published: boolean
}

/**
 * The session's site into the store. `publish: false` stops at the draft (for review or tests); `draftId` installs
 * into an existing draft; `request` gives the Host for the storefront refresh.
 */
export async function installStudioSite(
  session: StudioSiteInput,
  adminId: string | null,
  opts: { publish?: boolean; draftId?: string; request?: Pick<NextRequest, 'headers'> } = {}
): Promise<InstallResult> {
  const publish = opts.publish !== false
  const docs = new Map<string, { audience: SiteAudience; page: PageKey; doc: unknown }>()
  for (const [key, doc] of Object.entries(session.pages ?? {})) {
    const at = parseStudioKey(key)
    // Business pages share the store's header, footer and announcement bar.
    if (at && !(at.audience === 'business' && CHROME.has(at.page))) docs.set(`${at.audience}:${at.page}`, { ...at, doc })
  }
  for (const { audience, page, doc } of [...docs.values()]) {
    for (const extra of ALSO[page] ?? []) if (!docs.has(`${audience}:${extra}`)) docs.set(`${audience}:${extra}`, { audience, page: extra, doc })
  }
  if (!docs.size) throw new Error('The studio session has no pages')

  // Pages the store already has become the draft's base, so publishing replaces them cleanly.
  if (publish) await importLegacyLayouts(adminId)
  const draftId = opts.draftId ?? (await createSiteDraft(adminId, `AI Site Studio${session.style ? `: ${session.style}` : ''}`))
  const skipped: InstallResult['skipped'] = []
  const saved = new Set<string>()
  for (const [key, { audience, page, doc }] of docs) {
    const clean = await recompiled(doc as PageDoc, page).catch((err: Error) => {
      skipped.push({ key, reason: err.message?.slice(0, 200) ?? 'could not compile' })
      return null
    })
    if (!clean) continue
    for (const surface of ['web', 'web_mobile'] as const) {
      const ref: PageRef = { audience, surface, page, slug: '' }
      try {
        await saveDraftPage(draftId, ref, clean, adminId)
        saved.add(key)
      } catch (err) {
        skipped.push({ key: `${key}:${surface}`, reason: (err as Error).message?.slice(0, 200) ?? 'invalid page' })
      }
    }
  }
  if (session.theme) {
    for (const audience of ['store', 'business'] as const) await saveDraftTheme(draftId, audience, session.theme as Partial<ThemeTokens>, adminId)
  }
  const pages = saved.size
  if (!publish) return { draftId, pages, skipped, published: false }
  if (!pages) throw new Error(`No page could be installed: ${skipped[0]?.reason ?? 'unknown'}`)
  await publishSiteDraft(draftId, adminId)
  await setSiteBuilderEnabled(true)
  // Kept with the site so Site Builder can change its sections the studio way (studio/context.ts).
  await saveStudioContext(session).catch(err => console.warn('[studio] context not saved:', (err as Error).message))
  if (opts.request) await afterSiteChange(opts.request)
  return { draftId, pages, skipped, published: true }
}
