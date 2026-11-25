import { createHash, randomBytes } from 'crypto'
import { checkShowcaseSlug, createShowcaseDraft, type ShowcaseSiteRow } from '@/lib/showcase/store'
import { parseThemeId, themeDirection, themeIdOf, themeOfDirection, THEME_PALETTES, type ThemeStyleId } from '@/lib/site/themes/catalog'
import { templateReady } from '@/lib/site/themes/pages'
import type { DesignDirection } from '@/lib/site/studio'
import type { ShowcaseBusiness } from '@/lib/showcase/types'
import { startShowcaseStudio } from '@controller/lib/showcase-builder/studio'
import { applyTheme } from '@controller/lib/site-studio/themes'

// The instant sketch: a ready-made Showcase theme (pre-built sections that read the business's details live) applied
// to the draft's studio, so the preview shows a real page within a second or two and fills in as the call goes on.
// No AI, and the free generation stays unused. The theme is picked from the style the owner describes, else from
// the contact, so the full design that replaces it keeps the same palette.

const STYLE_WORDS: [ThemeStyleId, RegExp][] = [
  ['brutalist', /\b(bold|loud|bright|vibrant|colou?rful|fun|playful|young|street|funky|energetic)\b/i],
  ['glass', /\b(modern|sleek|tech|futuristic|glass|premium|glossy|trendy|stylish)\b/i],
  ['minimalist', /\b(simple|clean|minimal|elegant|classic|calm|professional|plain|traditional|subtle)\b/i],
]

const PALETTE_WORDS: Record<string, RegExp> = {
  'mono-ink': /\b(black|white|mono|monochrome|grey|gray)\b/i,
  sage: /\b(green|sage|natural|nature|olive|herbal)\b/i,
  sand: /\b(brown|sand|beige|earthy|earth|warm|wood)\b/i,
  ocean: /\b(blue|navy|ocean|sea)\b/i,
  blush: /\b(pink|rose|blush)\b/i,
  'safety-orange': /\b(orange|saffron)\b/i,
  acid: /\b(lime|neon|green)\b/i,
  cobalt: /\b(blue|cobalt|navy)\b/i,
  tomato: /\b(red|tomato)\b/i,
  lilac: /\b(purple|lilac|violet|lavender)\b/i,
  aurora: /\b(purple|violet)\b/i,
  sunset: /\b(red|orange|sunset|coral)\b/i,
  lagoon: /\b(blue|sky|lagoon|aqua)\b/i,
  orchid: /\b(pink|magenta|orchid)\b/i,
  mint: /\b(green|mint|teal)\b/i,
}

const pickIndex = (seed: string, n: number) => parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) % n

/**
 * The theme (`style.palette`) for a style description. `keep` is the theme worn now: a description that names no look
 * keeps its style, and one that names no colour keeps its palette.
 */
export function pickTheme(style: string | null | undefined, seed: string, keep?: string | null): string {
  const ready = (s: ThemeStyleId) => templateReady(s, 'showcase')
  const words = style ?? ''
  const cur = keep ? parseThemeId(keep) : null
  const named = STYLE_WORDS.find(([s, re]) => re.test(words) && ready(s))?.[0]
  const st: ThemeStyleId = named ?? (cur && ready(cur.style) ? cur.style : ready('minimalist') ? 'minimalist' : (STYLE_WORDS.map(([s]) => s).find(ready) ?? 'minimalist'))
  const palettes = THEME_PALETTES[st]
  const byColour = palettes.find(p => PALETTE_WORDS[p.id]?.test(words))
  const palette = byColour ?? (cur?.style === st ? cur.palette : palettes[pickIndex(seed, palettes.length)])
  return themeIdOf(st, palette.id)
}

/** The theme a studio direction wears (`style.palette`), when it came from one. */
export function wornTheme(direction: unknown): string | null {
  const t = themeOfDirection(direction)
  return t ? themeIdOf(t.style, t.palette.id) : null
}

/** The direction for a theme id. */
export function directionOf(themeId: string): DesignDirection {
  const t = parseThemeId(themeId)
  if (!t) throw new Error(`Unknown theme ${themeId}`)
  return themeDirection(t.style, t.palette)
}

/** Whether a description names a colour or a look (a change the palette or style can make). */
export const namesColourOrLook = (s: string) => Object.values(PALETTE_WORDS).some(re => re.test(s)) || STYLE_WORDS.some(([, re]) => re.test(s))

const slugBase = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')

/** A free site address from the business name (then with the city, then a short random tail). */
export async function freeSlug(name: string, city?: string | null): Promise<string> {
  const base = slugBase(name).length >= 3 ? slugBase(name) : `biz-${slugBase(name) || 'site'}`.slice(0, 40)
  const tries = [base, ...(city ? [`${base}-${slugBase(city)}`.slice(0, 58)] : []), ...Array.from({ length: 4 }, () => `${base}-${randomBytes(3).toString('hex')}`)]
  for (const slug of tries) if ((await checkShowcaseSlug(slug)).ok) return slug
  return `site-${randomBytes(6).toString('hex')}`
}

/** A new draft held by the outreach owner. */
export async function createOutreachDraft(ownerId: string, business: ShowcaseBusiness, city?: string | null): Promise<ShowcaseSiteRow> {
  for (let i = 0; i < 3; i++) {
    const r = await createShowcaseDraft({ ownerId, tenantId: null, slug: await freeSlug(business.name, city), business })
    if (r.ok) return r.site
  }
  throw new Error('No free site address for this business')
}

/** The theme as the draft's studio site, copied onto the draft at once; null when it could not be applied. */
export async function applySketch(ownerId: string, site: ShowcaseSiteRow, themeId: string): Promise<string | null> {
  const session = await startShowcaseStudio(ownerId, site)
  const r = await applyTheme(session, themeId, { replace: true })
  if (!r.ok) {
    console.warn(`[outreach-build] sketch theme ${themeId} not applied: ${r.error}`)
    return null
  }
  return themeId
}
