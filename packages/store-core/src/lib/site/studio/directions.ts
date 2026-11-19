import { randomUUID } from 'crypto'
import { FONT_CHOICES, STYLE_CHOICES, googleFontsHref, normalizeTheme, type ThemeTokens } from '@jeffi/site-blocks'
import { contrast } from '../critique'
import { askJson, clip, listOf, orNull, pick, rng, shuffle, studioBudgetLeft } from './ai'
import type { BriefReference, DesignDirection, StudioBrief, StudioTheme, StyleTokens } from './types'
import { uiStyle, type UiStyle } from './ui-styles'

// Design directions: a palette, a font pair from FONT_CHOICES, shape and style tokens, and a layout feel. The model
// proposes them for the brief; anything unusable is filled from seeded pools (a different seed, a different set), and
// colours are corrected for contrast. "Shuffle colours" is local and instant; "new direction" asks for one more.

const HEX = /^#[0-9a-f]{6}$/i
const FONTS = FONT_CHOICES.map(f => f.name)

interface Feel {
  id: string
  text: string
  theme: Pick<ThemeTokens, 'radius' | 'buttonStyle' | 'density'>
  style: StyleTokens
  kind: 'serif' | 'sans' | 'display'
}

const FEELS: Feel[] = [
  { id: 'editorial', kind: 'serif', text: 'Airy editorial: large serif headlines, asymmetric grids, full-bleed pictures and generous white space', theme: { radius: 'none', buttonStyle: 'outline', density: 'airy' }, style: { buttonShape: 'square', cardStyle: 'flat', inputStyle: 'underline', headingCase: 'normal', headingTracking: 'tight', shadow: 'none' } },
  { id: 'bazaar', kind: 'sans', text: 'Lively bazaar: compact rows, badges and countdowns, strong colour bands, lots to scan', theme: { radius: 'md', buttonStyle: 'solid', density: 'compact' }, style: { buttonShape: 'rounded', cardStyle: 'outlined', inputStyle: 'outlined', headingCase: 'normal', headingTracking: 'normal', shadow: 'soft' } },
  { id: 'boutique', kind: 'serif', text: 'Soft boutique: centered compositions, rounded cards, gentle shadows and calm spacing', theme: { radius: 'lg', buttonStyle: 'solid', density: 'airy' }, style: { buttonShape: 'rounded', cardStyle: 'shadow', inputStyle: 'filled', headingCase: 'normal', headingTracking: 'normal', shadow: 'soft' } },
  { id: 'poster', kind: 'display', text: 'Bold poster: oversized uppercase type, colour-blocked bands, marquees and hard edges', theme: { radius: 'none', buttonStyle: 'solid', density: 'comfortable' }, style: { buttonShape: 'square', cardStyle: 'outlined', inputStyle: 'outlined', headingCase: 'upper', headingTracking: 'wide', shadow: 'strong' } },
  { id: 'grid', kind: 'sans', text: 'Clean modern grid: thin rules, square corners, mostly monochrome with one sharp accent', theme: { radius: 'sm', buttonStyle: 'solid', density: 'comfortable' }, style: { buttonShape: 'square', cardStyle: 'outlined', inputStyle: 'outlined', headingCase: 'normal', headingTracking: 'tight', shadow: 'none' } },
  { id: 'crafted', kind: 'serif', text: 'Warm crafted: tinted bands, rounded pictures, story-led alternating splits', theme: { radius: 'md', buttonStyle: 'outline', density: 'comfortable' }, style: { buttonShape: 'rounded', cardStyle: 'flat', inputStyle: 'filled', headingCase: 'normal', headingTracking: 'normal', shadow: 'soft' } },
  { id: 'playful', kind: 'display', text: 'Playful collage: overlapping cards, tilted labels, pill buttons and bright accents', theme: { radius: 'full', buttonStyle: 'pill', density: 'comfortable' }, style: { buttonShape: 'pill', cardStyle: 'shadow', inputStyle: 'filled', headingCase: 'normal', headingTracking: 'normal', shadow: 'strong' } },
  { id: 'gallery', kind: 'sans', text: 'Gallery minimal: picture-first tiles, small uppercase labels, wide margins', theme: { radius: 'none', buttonStyle: 'outline', density: 'airy' }, style: { buttonShape: 'square', cardStyle: 'flat', inputStyle: 'underline', headingCase: 'upper', headingTracking: 'wide', shadow: 'none' } },
  { id: 'brutalist', kind: 'display', text: 'Raw brutalist: thick dark borders, hard offset shadows, square corners, monospace labels, flat high-contrast colour', theme: { radius: 'none', buttonStyle: 'solid', density: 'comfortable' }, style: { buttonShape: 'square', cardStyle: 'outlined', inputStyle: 'outlined', headingCase: 'upper', headingTracking: 'normal', shadow: 'strong' } },
  { id: 'luxury', kind: 'serif', text: 'Quiet luxury: centred compositions, thin serif small caps with wide spacing, deep muted colour and a gold accent', theme: { radius: 'none', buttonStyle: 'outline', density: 'airy' }, style: { buttonShape: 'square', cardStyle: 'flat', inputStyle: 'underline', headingCase: 'upper', headingTracking: 'wide', shadow: 'none' } },
]

/** The owner's picked style as a feel: its layout text, its shape tokens. */
function styledFeel(st: UiStyle): Feel {
  const base = FEELS.find(f => f.id === st.feel) ?? FEELS[0]
  const { radius, buttonStyle, density, ...style } = st.tokens
  return { ...base, text: `${st.name}: ${st.rules}`, theme: { radius, buttonStyle, density }, style }
}

const pairsFor = (feel: Feel, st: UiStyle | null): [string, string][] => (st ? st.fonts : PAIRS[feel.kind])

const PAIRS: Record<Feel['kind'], [string, string][]> = {
  serif: [['Playfair Display', 'Inter'], ['Cormorant Garamond', 'Manrope'], ['Lora', 'DM Sans'], ['Libre Baskerville', 'Plus Jakarta Sans'], ['Marcellus', 'Poppins'], ['Cinzel', 'Lora'], ['Cormorant Garamond', 'Lora']],
  sans: [['Space Grotesk', 'Inter'], ['Montserrat', 'DM Sans'], ['Josefin Sans', 'Manrope'], ['Plus Jakarta Sans', 'Inter'], ['Poppins', 'Inter'], ['Manrope', 'DM Sans']],
  display: [['Bebas Neue', 'Inter'], ['Archivo Black', 'Manrope'], ['Bebas Neue', 'DM Sans'], ['Archivo Black', 'Poppins'], ['Bebas Neue', 'Space Grotesk']],
}

// Base hues a mood suggests; anything else starts from the seed.
const MOOD_HUES: [RegExp, number][] = [
  [/festive|wedding|celebrat|saffron|diwali/i, 22],
  [/luxur|heritage|royal|couture|bridal/i, 350],
  [/earth|craft|organic|handmade|natural|rustic/i, 28],
  [/minimal|modern|clean|simple/i, 220],
  [/playful|kid|fun|bright|young/i, 330],
  [/tech|gadget|electronic|tool/i, 150],
  [/ocean|fresh|calm|spa|wellness/i, 185],
  [/forest|green|plant|ayur/i, 120],
]

// ── Colour helpers ────────────────────────────────────────────────────────────────────────────────

function hsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return `#${[f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('')}`
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60
  return [h, s, l]
}

/** Darkens a colour until white text on it reads (ratio ≥ min). */
function readableOnWhite(hex: string, min: number): string {
  let [h, s, l] = toHsl(hex)
  let out = hex
  while (contrast(out, '#ffffff') < min && l > 0.05) {
    l -= 0.04
    out = hsl(h, s, l)
  }
  return out
}

function palette(r: () => number, baseHue: number): Pick<ThemeTokens, 'primary' | 'accent' | 'neutral'> {
  const h = (baseHue + (r() - 0.5) * 50 + 360) % 360
  const scheme = pick(r, [150, 180, 210, 30, -30, 120] as const)
  const primary = hsl(h, 0.45 + r() * 0.4, 0.3 + r() * 0.18)
  const accent = hsl((h + scheme + 360) % 360, 0.5 + r() * 0.4, 0.4 + r() * 0.15)
  const neutral = hsl(h, 0.08 + r() * 0.15, 0.1 + r() * 0.06)
  return fixColours({ primary, accent, neutral })
}

function fixColours(c: Pick<ThemeTokens, 'primary' | 'accent' | 'neutral'>) {
  return { primary: readableOnWhite(c.primary, 3.2), accent: readableOnWhite(c.accent, 2.6), neutral: readableOnWhite(c.neutral, 9) }
}

function baseHue(b: StudioBrief, r: () => number): number {
  const text = `${b.mood} ${b.category} ${b.summary}`
  return MOOD_HUES.find(([re]) => re.test(text))?.[1] ?? Math.floor(r() * 360)
}

// ── Directions ────────────────────────────────────────────────────────────────────────────────────

function finish(name: string, theme: Partial<StudioTheme>, feel: Feel, layoutFeel: string, rationale: string): DesignDirection {
  const base = normalizeTheme(theme)
  const style = { ...feel.style, ...pickStyle(theme) }
  const full = { ...base, ...style, ...fixColours(base) } as StudioTheme
  return { id: randomUUID().slice(0, 8), name, theme: full, feel: feel.id, layoutFeel, rationale, fontsHref: googleFontsHref(full) }
}

function pickStyle(t: Record<string, unknown>): Partial<StyleTokens> {
  return Object.fromEntries(Object.entries(STYLE_CHOICES).filter(([k, list]) => (list as readonly unknown[]).includes(t[k])).map(([k]) => [k, t[k]])) as Partial<StyleTokens>
}

function localDirection(b: StudioBrief, r: () => number, feel: Feel, st: UiStyle | null = null): DesignDirection {
  const [display, body] = pick(r, pairsFor(feel, st))
  const refFont = b.references.find(x => x.fonts.display && FONTS.includes(x.fonts.display))?.fonts.display
  const theme = { ...palette(r, baseHue(b, r)), ...feel.theme, fontDisplay: refFont && r() < 0.3 ? refFont : display, fontBody: body }
  const name = `${pick(r, ['Quiet', 'Bold', 'Warm', 'Bright', 'Deep', 'Soft', 'Crisp', 'Rich'])} ${pick(r, ['Bazaar', 'Atelier', 'Studio', 'Market', 'Gallery', 'Courtyard', 'Loom', 'Signal'])}`
  return finish(name, theme, feel, feel.text, `${feel.text.split(':')[0]} for ${b.category || 'the store'}.`)
}

function fromModel(o: Record<string, unknown>, fallbackFeel: Feel, st: UiStyle | null = null): DesignDirection | null {
  if (st) {
    // A picked style keeps its shape; the model only varies colour and the font pair (from the style's own pairs).
    const pair = st.fonts.find(([d]) => d.toLowerCase() === String((o.fonts as Record<string, unknown> | undefined)?.display ?? '').toLowerCase()) ?? st.fonts[0]
    o = { ...o, ...st.tokens, feel: st.feel, fonts: { display: pair[0], body: pair[1] } }
    fallbackFeel = styledFeel(st)
  }
  const pal = (o.palette && typeof o.palette === 'object' ? o.palette : o) as Record<string, unknown>
  const fonts = (o.fonts && typeof o.fonts === 'object' ? o.fonts : o) as Record<string, unknown>
  const primary = String(pal.primary ?? '')
  const accent = String(pal.accent ?? '')
  if (!HEX.test(primary) || !HEX.test(accent)) return null
  const fontDisplay = FONTS.find(f => f.toLowerCase() === String(fonts.fontDisplay ?? fonts.display ?? fonts.heading ?? '').toLowerCase())
  const fontBody = FONTS.find(f => f.toLowerCase() === String(fonts.fontBody ?? fonts.body ?? '').toLowerCase())
  const feel = st ? fallbackFeel : (FEELS.find(f => f.id === o.feel) ?? fallbackFeel)
  const [d, bo] = PAIRS[feel.kind][0]
  const neutral = HEX.test(String(pal.neutral ?? '')) ? String(pal.neutral) : hsl(toHsl(primary)[0], 0.15, 0.12)
  const theme = { ...feel.theme, ...o, primary, accent, neutral, fontDisplay: fontDisplay ?? d, fontBody: fontBody ?? bo } as Partial<StudioTheme>
  return finish(clip(o.name, 40, 'Direction'), theme, feel, clip(o.layoutFeel ?? o.layout, 320, feel.text), clip(o.rationale ?? o.why, 200, feel.text))
}

/** A reference site's colours as a readable palette, or null when it showed none worth using. */
function referencePalette(colors: string[]): Pick<ThemeTokens, 'primary' | 'accent' | 'neutral'> | null {
  const hex = colors.map(c => (/^#[0-9a-f]{3}$/i.test(c) ? `#${[...c.slice(1)].map(x => x + x).join('')}` : c)).filter(c => HEX.test(c))
  const colourful = hex
    .map(c => ({ c, h: toHsl(c) }))
    .filter(x => x.h[1] > 0.25 && x.h[2] > 0.12 && x.h[2] < 0.85)
    .sort((a, b) => b.h[1] - a.h[1])
  if (!colourful.length) return null
  const [first] = colourful
  // The accent is the next brand colour with a clearly different hue (not a second shade of the first).
  const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)
  const accent = colourful.find(x => hueGap(x.h[0], first.h[0]) > 25)?.c ?? hsl((first.h[0] + 150) % 360, 0.6, 0.45)
  const darkest = hex.map(c => ({ c, l: toHsl(c)[2] })).sort((a, b) => a.l - b.l)[0]
  const neutral = darkest && darkest.l < 0.2 ? darkest.c : hsl(first.h[0], 0.15, 0.12)
  return fixColours({ primary: first.c, accent, neutral })
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** The look of a site the owner likes: its colours and fonts, in their picked style or a feel that suits the site. */
function referenceDirection(b: StudioBrief, ref: BriefReference, r: () => number, st: UiStyle | null): DesignDirection | null {
  const pal = referencePalette(ref.colors)
  const display = ref.fonts.display && FONTS.includes(ref.fonts.display) ? ref.fonts.display : null
  if (!pal && !display) return null
  const feel = st ? styledFeel(st) : (FEELS.find(f => f.id === (ref.density === 'compact' ? 'bazaar' : ref.imageLed ? 'gallery' : ref.density === 'airy' ? 'editorial' : 'grid')) ?? FEELS[0])
  const [d, bo] = pick(r, pairsFor(feel, st))
  // In a picked style its heading font stays; the site's main font sets the body text.
  const body = st ? (display ?? bo) : ref.fonts.body && FONTS.includes(ref.fonts.body) ? ref.fonts.body : bo
  const host = hostOf(ref.url)
  const theme = { ...(pal ?? palette(r, baseHue(b, r))), ...feel.theme, ...(st ? {} : ref.uppercaseLabels ? { headingCase: 'upper' as const } : {}), fontDisplay: st ? d : (display ?? d), fontBody: body }
  const layout = `${ref.feel} ${ref.density} spacing, ${ref.imageLed ? 'picture-led' : 'type-led'}.`
  return { ...finish(`Like ${host}`, theme, feel, layout, `The colours${display ? (st ? ' and body type' : ' and type') : ''} of ${host}${st ? ` in the ${st.name} style` : ''}, made for ${b.storeName}.`), reference: host }
}

const DIRECTION_SHAPE = `{"name": 2-3 evocative words, "feel": one of ${FEELS.map(f => f.id).join('|')}, "palette": {"primary": "#rrggbb" (buttons, white text on it), "accent": "#rrggbb", "neutral": "#rrggbb" (dark text colour)}, "fonts": {"display": one of [${FONTS.join(', ')}], "body": one of the same list}, "radius": "none"|"sm"|"md"|"lg"|"full", "buttonStyle": "solid"|"outline"|"pill", "density": "compact"|"comfortable"|"airy", "buttonShape": "square"|"rounded"|"pill", "cardStyle": "flat"|"outlined"|"shadow", "inputStyle": "outlined"|"filled"|"underline", "headingCase": "normal"|"upper", "headingTracking": "tight"|"normal"|"wide", "shadow": "none"|"soft"|"strong", "layoutFeel": one sentence on how pages are composed (grids, spacing, picture treatment, motion), "rationale": one line on why it suits this store}`

const briefLine = (b: StudioBrief) =>
  `${b.kind === 'showcase' ? `Business: ${b.storeName}. ${b.summary} Does ${b.category} for ${b.audience}.` : `Store: ${b.storeName}. ${b.summary} Sells ${b.category} to ${b.audience}.`} Price tier ${b.priceTier}. Voice: ${b.voice}. Mood: ${b.mood}.${b.references.length ? ` Sites they like: ${b.references.map(x => `${x.feel} (colours ${x.colors.slice(0, 3).join(', ') || 'unknown'}, ${x.density})`).join(' | ')}.` : ''}`

/**
 * `n` distinct directions for the brief. `opts.avoid` lists directions already shown (so new ones differ) and
 * `opts.ask` is the owner's free-text override ("more pink, a serif").
 */
export async function directions(b: StudioBrief, n = 3, opts: { avoid?: DesignDirection[]; ask?: string } = {}): Promise<DesignDirection[]> {
  const r = rng(b.seed ^ (opts.avoid?.length ?? 0) * 7919, `directions:${opts.ask ?? ''}`)
  const st = uiStyle(b.uiStyle)
  const feels = st ? [styledFeel(st)] : shuffle(r, FEELS.filter(f => !opts.avoid?.some(a => a.feel === f.id)))
  // The first set leads with the look of the site they like (once).
  const fromRef = !opts.ask && n > 1 ? (b.references.map(x => referenceDirection(b, x, r, st)).find(Boolean) ?? null) : null
  const want = fromRef ? n - 1 : n
  const out =
    studioBudgetLeft() > 0
      ? await askJson(
          `You are the art director for ${b.kind === 'showcase' ? "a new Indian business's one-page website" : "a new Indian online store's website"}. Propose ${want} clearly different visual directions: ${st ? `all in the owner's chosen ${st.name} style (${st.rules}); keep its shape and vary the colour palette and the font pair, choosing from ${st.fonts.map(p => `${p[0]} + ${p[1]}`).join('; ')}` : 'vary colour temperature, type (serif / sans / display) and layout feel between them'}. Colours must fit the store, never a generic default; keep white text readable on the primary.
Return JSON {"directions": [${DIRECTION_SHAPE}]}.`,
          `${briefLine(b)}
${opts.ask ? `The owner asks: ${opts.ask}\n` : ''}${opts.avoid?.length ? `Already shown (make these different): ${opts.avoid.map(a => `${a.name} (${a.theme.primary}, ${a.theme.fontDisplay}/${a.theme.fontBody}, ${a.layoutFeel})`).join('; ')}\n` : ''}Feels to consider: ${feels.slice(0, n + 2).map(f => `${f.id} (${f.text})`).join('; ')}.`,
          { maxTokens: 900 * want + 400, temperature: 0.95 }
        ).catch(orNull)
      : null
  const got = listOf(out, 'directions', 'options')
    .map((o, i) => (o && typeof o === 'object' ? fromModel(o as Record<string, unknown>, feels[i % feels.length] ?? FEELS[i % FEELS.length], st) : null))
    .filter((d): d is DesignDirection => !!d)
  // Two directions with the same primary or the same font pair aren't a choice (nor one that repeats a shown one);
  // within one picked style, the same primary is enough to repeat.
  const distinct: DesignDirection[] = fromRef ? [fromRef] : []
  for (const d of got) {
    const same = (x: DesignDirection) => x.theme.primary === d.theme.primary || (!st && x.theme.fontDisplay === d.theme.fontDisplay && x.theme.fontBody === d.theme.fontBody)
    if (!distinct.some(same) && !opts.avoid?.some(same)) distinct.push(d)
  }
  for (let i = 0; distinct.length < n; i++) distinct.push(localDirection(b, r, feels[i % feels.length] ?? FEELS[i % FEELS.length], st))
  return distinct.slice(0, n)
}

/** One more direction, different from those shown. */
export async function newDirection(b: StudioBrief, shown: DesignDirection[], ask?: string): Promise<DesignDirection> {
  return (await directions(b, 1, { avoid: shown, ask }))[0]
}

/** The same direction with a new palette (fonts, shape and feel kept); local, no AI call. */
export function shuffleColours(b: StudioBrief, d: DesignDirection): DesignDirection {
  const r = rng(Date.now() ^ b.seed, d.id)
  const hue = (toHsl(d.theme.primary)[0] + 60 + r() * 240) % 360
  const theme = { ...d.theme, ...palette(r, hue) }
  // New colours are no longer the reference site's.
  const { reference: _ref, ...rest } = d
  return { ...rest, id: randomUUID().slice(0, 8), name: d.reference ? `After ${d.reference}` : d.name, theme, fontsHref: googleFontsHref(theme) }
}
