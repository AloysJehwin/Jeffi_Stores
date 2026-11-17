import type { PageDoc } from '@jeffi/site-blocks'
import type { SampleCatalog } from '../data/types'
import { getSiteDraft } from '../store'
import { newSeed, runStudioFunded } from '../studio/ai'
import { cleanAnswers } from '../studio/brief'
import { installStudioSite } from '../studio/install'
import { plan as planSite } from '../studio/plan'
import type { DesignDirection, PlannedPage, PlannedSection, StudioAnswers, StudioBrief, StudioPlan, StudioTheme } from '../studio/types'
import { parseThemeId, themeDirection, themeName, themeStyle, themeTokens, type ThemeStyleId } from './catalog'
import { SHOWCASE_HOME, templateFile, themePages, type ThemeProduct } from './pages'
import { themeSample } from './sample'

// Applying a ready-made theme. In the studio it becomes the session's whole site at once: the style's pages with
// fresh ids, the palette as the theme, a matching design direction, a brief from the owner's own details and a static
// sample catalogue for the preview, all without AI, so the free generation stays unused. On a live store (Site
// Builder) its pages and theme go into a draft through the studio's own install, never straight to live.

/** A theme as a studio session's site. */
export interface ThemeSite {
  brief: StudioBrief
  plan: StudioPlan
  direction: DesignDirection
  theme: StudioTheme
  pages: Record<string, PageDoc>
  /** The sample catalogue the store's preview shows (a Showcase previews its own details and content). */
  catalog: SampleCatalog | null
}

/** Who the site is for: their answers (name, tagline, story, logo, contacts) and, for a store, its sample's store. */
export interface ThemeOwner {
  answers: StudioAnswers | Record<string, unknown>
  /** The store's first selling category, for its sample catalogue. */
  category?: string | null
  /** The sample's store: the owner's name, logo and contacts as the preview shows them. */
  store?: SampleCatalog['store']
  /** A sample to use when the category has no generated one (its starter products). */
  fallbackSample?: SampleCatalog | null
}

function themeBrief(style: ThemeStyleId, a: StudioAnswers, product: ThemeProduct, category: string | null | undefined): StudioBrief {
  const st = themeStyle(style)
  const showcase = product === 'showcase'
  const name = a.storeName || (showcase ? 'Your business' : 'Your store')
  return {
    storeName: name,
    summary: (a.about || a.tagline || a.sell || `${name}.`).slice(0, 300),
    category: (category || a.sell || '').slice(0, 120),
    vocabulary: [],
    audience: a.audience || (showcase ? 'clients nearby' : 'shoppers across India'),
    priceTier: 'mid',
    voice: 'warm, clear and brief',
    mood: a.mood || `${st.name.toLowerCase()}: ${st.blurb.toLowerCase()}`,
    artDirection: 'Natural light, clean backgrounds, true-to-life colour',
    references: [],
    uiStyle: style,
    logoUrl: a.logoUrl ?? null,
    tagline: a.tagline,
    about: a.about,
    contact: a.contact,
    socials: a.socials,
    seed: newSeed(),
    ...(showcase ? { kind: 'showcase' as const } : {}),
  }
}

/** A page's sections as the template has them, with the intents they were written from when the plan still has them. */
function sectionsOf(doc: PageDoc, stored: PlannedPage | undefined): PlannedSection[] {
  return doc.order.map((id, i) => {
    const label = String(doc.blocks[id]?.props.label ?? 'Section')
    const was = stored?.sections.find(s => s.label === label)
    return { id: `s${i + 1}`, label, intent: was?.intent ?? label, layout: was?.layout ?? '', parts: was?.parts ?? [] }
  })
}

/**
 * The plan for a theme's pages: today's page list and themed pages (planned with no budget, so no AI), each page with
 * the sections the template gives it; pages the template lacks are left out of the site.
 */
async function themePlan(pages: Record<string, PageDoc>, stored: StudioPlan | null | undefined, brief: StudioBrief, product: ThemeProduct): Promise<StudioPlan> {
  if (product === 'showcase') {
    const was = stored?.pages.find(p => p.key === SHOWCASE_HOME)
    const page: PlannedPage = {
      key: SHOWCASE_HOME,
      audience: 'store',
      page: 'showcase',
      label: was?.label ?? 'Your page',
      optional: false,
      enabled: true,
      approach: was?.approach ?? '',
      sections: sectionsOf(pages[SHOWCASE_HOME], was),
      required: was?.required ?? ['LeadForm'],
    }
    return { approach: stored?.approach ?? { id: 'theme', name: 'Theme', description: '' }, pages: [page], themed: [] }
  }
  const base = await runStudioFunded(() => planSite(brief, ['store']), 0, 'site-theme')
  return {
    approach: stored?.approach ?? base.approach,
    pages: base.pages.map(p => {
      const doc = pages[p.key]
      const was = stored?.pages.find(x => x.key === p.key)
      return doc ? { ...p, approach: was?.approach ?? p.approach, sections: sectionsOf(doc, was), enabled: true } : { ...p, enabled: false }
    }),
    themed: base.themed,
  }
}

/** A theme (`minimalist.ocean`) as a studio session's site, for a store or a Showcase; null when it is not ready. */
export async function themeSite(themeId: unknown, product: ThemeProduct, owner: ThemeOwner): Promise<ThemeSite | null> {
  const t = parseThemeId(themeId)
  if (!t) return null
  const pages = await themePages(t.style, product)
  if (!pages || !Object.keys(pages).length) return null
  const answers = cleanAnswers(owner.answers)
  const brief = themeBrief(t.style, answers, product, owner.category)
  const direction = themeDirection(t.style, t.palette)
  const plan = await themePlan(pages, templateFile(t.style, product)?.plan, brief, product)
  const catalog = product === 'showcase' ? null : themeSample(owner.category, owner.store ?? { name: brief.storeName }, owner.fallbackSample)
  return { brief, plan, direction, theme: direction.theme, pages, catalog }
}

/**
 * A theme into a Site Builder draft: its pages (desktop and phone, recompiled) and its palette as the store's and the
 * business portal's theme. Live only when the owner publishes the draft. Null for an unknown or unready theme.
 */
export async function applyThemeToDraft(draftId: string, themeId: unknown, adminId: string | null): Promise<{ pages: number; name: string; skipped: number } | null> {
  const t = parseThemeId(themeId)
  if (!t) return null
  if (!(await getSiteDraft(draftId))) throw new Error('Draft not found')
  const pages = await themePages(t.style, 'store')
  if (!pages || !Object.keys(pages).length) return null
  const name = themeName(t.style, t.palette)
  const r = await installStudioSite({ pages, theme: themeTokens(t.style, t.palette), style: name }, adminId, { publish: false, draftId })
  return { pages: r.pages, name, skipped: r.skipped.length }
}
