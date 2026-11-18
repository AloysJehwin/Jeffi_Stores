import { googleFontsHref, paletteFrom } from '@jeffi/site-blocks'
import { uiStyle, type UiStyle, type UiStyleId } from '../studio/ui-styles'
import type { DesignDirection, StudioTheme } from '../studio/types'

// Ready-made themes: five of the studio's design styles, five palettes each. A theme is a style's pre-built pages
// (templates/, made by scripts/site-themes/generate-templates.ts) worn in one palette, with the style's fonts and shape
// tokens. Client-safe: the wizard and Site Builder draw the gallery from this file; the pages load server-side
// (templates.ts).

export const THEME_STYLES = ['minimalist', 'brutalist', 'glass', 'luxury', 'playful'] as const satisfies readonly UiStyleId[]
export type ThemeStyleId = (typeof THEME_STYLES)[number]

export interface ThemePalette {
  id: string
  name: string
  primary: string
  accent: string
  neutral: string
}

const pal = (name: string, primary: string, accent: string, neutral: string): ThemePalette => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  name,
  primary,
  accent,
  neutral,
})

// Each style's palettes share one lightness profile, so its templates can fix which text goes on which fill (INK).
// Shades nudged for WCAG AA against INK: amber #f59e0b → #f19b0a (white on its 700), cobalt #1f4cff → #4369ff (dark
// text on it).
export const THEME_PALETTES: Record<ThemeStyleId, ThemePalette[]> = {
  minimalist: [
    pal('Mono Ink', '#111111', '#2563eb', '#1f2937'),
    pal('Sage', '#3f5e4a', '#c08457', '#1f2a24'),
    pal('Sand', '#8a6a4f', '#1e3a8a', '#292524'),
    pal('Ocean', '#0f4c81', '#f19b0a', '#0f172a'),
    pal('Blush', '#b4536b', '#4b5563', '#27272a'),
  ],
  brutalist: [
    pal('Safety Orange', '#ff4d00', '#ffd400', '#0a0a0a'),
    pal('Acid', '#c6ff00', '#ff2e88', '#0a0a0a'),
    pal('Cobalt', '#4369ff', '#ffcf00', '#0a0a0a'),
    pal('Tomato', '#ff3b30', '#00c2a8', '#111111'),
    pal('Lilac', '#a78bfa', '#fde047', '#0a0a0a'),
  ],
  glass: [
    pal('Aurora', '#7c3aed', '#06b6d4', '#0f172a'),
    pal('Sunset', '#f43f5e', '#f19b0a', '#1c1917'),
    pal('Lagoon', '#0ea5e9', '#22c55e', '#082f49'),
    pal('Orchid', '#c026d3', '#6366f1', '#1e1b4b'),
    pal('Mint', '#10b981', '#3b82f6', '#052e2b'),
  ],
  luxury: [
    pal('Noir Gold', '#c9a45c', '#e8d9b8', '#14110f'),
    pal('Emerald', '#1f6f5c', '#d4af37', '#0b1f1a'),
    pal('Ivory', '#8c6d46', '#1c1c1c', '#2b2622'),
    pal('Burgundy', '#7b1e3a', '#d8b26e', '#1a0f12'),
    pal('Midnight', '#2b3a67', '#c0c0c0', '#0b0f1f'),
  ],
  playful: [
    pal('Bubblegum', '#db2777', '#f19b0a', '#1f2937'),
    pal('Candy', '#7c3aed', '#10b981', '#1e1b4b'),
    pal('Citrus', '#ea580c', '#65a30d', '#1c1917'),
    pal('Sky', '#2563eb', '#f472b6', '#0f172a'),
    pal('Mango', '#f19b0a', '#0ea5e9', '#1f2937'),
  ],
}

type Shade = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900
type Ref = 'white' | `${'primary' | 'accent' | 'secondary'}-${Shade}`

/**
 * Which text sits on which fill in each style's templates (template-rules.ts tells the writer; every palette of the
 * style is checked against it at AA). text-white on a 500 or 600 fill takes the theme's readable ink instead
 * (themeCssVars --on-*, globals.css), so those fills need no pair.
 */
export const INK: Record<ThemeStyleId, { rule: string; pairs: [text: Ref, on: Ref][] }> = {
  minimalist: {
    rule: 'A light page (bg-surface, white). Buttons and dark bands: bg-primary-700 (hover:bg-primary-800) or bg-secondary-900, with text-white. Coloured text on light: text-primary-700 or text-accent-700. The accent is a small detail (a label, a link, a dot, a thin rule), never a large fill.',
    pairs: [['white', 'primary-700'], ['primary-700', 'white'], ['accent-700', 'white'], ['white', 'accent-700'], ['white', 'secondary-900']],
  },
  brutalist: {
    rule: 'A light or tinted page (bg-surface, bg-primary-50, bg-accent-50). Bright blocks and buttons: bg-primary-500 or bg-accent-500 with text-secondary-900 and border-2 border-secondary-900. Dark bands: bg-secondary-900 with text-white, bright words on them in text-primary-500 or text-accent-500. Text on white is text-secondary-900.',
    pairs: [['secondary-900', 'primary-500'], ['secondary-900', 'accent-500'], ['primary-500', 'secondary-900'], ['accent-500', 'secondary-900'], ['secondary-900', 'white']],
  },
  glass: {
    rule: 'Soft light gradients of primary-100 and accent-100 tints behind glass panels (bg-white/60). Pill buttons: bg-primary-700 (hover:bg-primary-800) with text-white, or white glass with text-secondary-900. Coloured text: text-primary-700 or text-accent-700. Blurred blobs: bg-primary-300/40, bg-accent-300/40.',
    pairs: [['white', 'primary-700'], ['primary-700', 'white'], ['accent-700', 'white'], ['secondary-900', 'primary-100'], ['white', 'secondary-900']],
  },
  luxury: {
    rule: 'Dark bands (bg-secondary-900 with text-white, body copy text-white/70) alternate with quiet light sections (bg-surface with text-secondary-900). On dark, headings, labels and thin rules in the 300 shades (text-primary-300, text-accent-300, border-primary-300/40). On light, coloured text is text-primary-700. Buttons: outlined (border border-primary-300 text-primary-300 on dark; border border-secondary-900 text-secondary-900 on light) or filled bg-primary-700 with text-white.',
    pairs: [['primary-300', 'secondary-900'], ['accent-300', 'secondary-900'], ['white', 'primary-700'], ['primary-700', 'white'], ['white', 'secondary-900']],
  },
  playful: {
    rule: 'A light page with tinted bands (bg-primary-50, bg-accent-100). Pill buttons: bg-primary-700 (hover:bg-primary-800) with text-white. Stickers and bright bands: bg-accent-500 or bg-accent-400 with text-secondary-900. Coloured text: text-primary-700 or text-accent-700.',
    pairs: [['white', 'primary-700'], ['primary-700', 'white'], ['secondary-900', 'accent-500'], ['accent-700', 'white'], ['secondary-900', 'primary-100']],
  },
}

export const isThemeStyle = (v: unknown): v is ThemeStyleId => (THEME_STYLES as readonly unknown[]).includes(v)

/** `minimalist.ocean` */
export const themeIdOf = (style: ThemeStyleId, palette: string) => `${style}.${palette}`

export function parseThemeId(id: unknown): { style: ThemeStyleId; palette: ThemePalette } | null {
  if (typeof id !== 'string') return null
  const [style, paletteId] = id.split('.')
  if (!isThemeStyle(style)) return null
  const palette = THEME_PALETTES[style].find(p => p.id === paletteId)
  return palette ? { style, palette } : null
}

export const themeStyle = (style: ThemeStyleId): UiStyle => uiStyle(style)!

/** The font pair a palette wears: the style's own pairs in turn, the first with the first palette (the templates' own). */
function fontsFor(style: ThemeStyleId, palette: ThemePalette): [string, string] {
  const fonts = themeStyle(style).fonts
  return fonts[Math.max(0, THEME_PALETTES[style].indexOf(palette)) % fonts.length]
}

/** The theme tokens: the palette, the style's fonts and every shape and style token. */
export function themeTokens(style: ThemeStyleId, palette: ThemePalette): StudioTheme {
  const [fontDisplay, fontBody] = fontsFor(style, palette)
  return { primary: palette.primary, accent: palette.accent, neutral: palette.neutral, fontDisplay, fontBody, ...themeStyle(style).tokens }
}

export const themeName = (style: ThemeStyleId, palette: ThemePalette) => `${themeStyle(style).name} · ${palette.name}`

/** A theme among Site Builder's site packs (`theme:minimalist.ocean`, the pack id drafts/[id]/pack takes). */
export const THEME_PACK_PREFIX = 'theme:'
const DIRECTION_PREFIX = THEME_PACK_PREFIX

/** The design direction a theme stands for (the studio's AI changes follow it). Its id names the theme. */
export function themeDirection(style: ThemeStyleId, palette: ThemePalette): DesignDirection {
  const st = themeStyle(style)
  const theme = themeTokens(style, palette)
  return {
    id: `${DIRECTION_PREFIX}${themeIdOf(style, palette.id)}`,
    name: themeName(style, palette),
    theme,
    feel: st.feel,
    layoutFeel: `${st.name}: ${st.rules}`,
    rationale: `The ready-made ${st.name} theme in its ${palette.name} palette.`,
    fontsHref: googleFontsHref(theme),
  }
}

/** The theme a direction came from, when it was made from one. */
export function themeOfDirection(d: unknown): { style: ThemeStyleId; palette: ThemePalette } | null {
  const id = d && typeof d === 'object' ? (d as { id?: unknown }).id : null
  return typeof id === 'string' && id.startsWith(DIRECTION_PREFIX) ? parseThemeId(id.slice(DIRECTION_PREFIX.length)) : null
}

// ── Contrast (WCAG 2.1) ──────────────────────────────────────────────────────────────────────────────

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrastRatio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

function colourOf(ref: Ref, p: ThemePalette): string {
  if (ref === 'white') return '#ffffff'
  const [scale, shade] = ref.split('-') as ['primary' | 'accent' | 'secondary', string]
  return paletteFrom(scale === 'secondary' ? p.neutral : p[scale])[Number(shade) as Shade]
}

/** The style's text-on-fill pairs that fall under AA (4.5:1) in this palette; none for every shipped palette. */
export function paletteIssues(style: ThemeStyleId, p: ThemePalette): string[] {
  return INK[style].pairs
    .map(([text, on]) => ({ text, on, ratio: contrastRatio(colourOf(text, p), colourOf(on, p)) }))
    .filter(x => x.ratio < 4.5)
    .map(x => `${x.text} on ${x.on}: ${x.ratio.toFixed(2)}:1`)
}

// ── The gallery ──────────────────────────────────────────────────────────────────────────────────────

/** What a gallery shows of a theme. */
export interface ThemeCard {
  id: string
  style: ThemeStyleId
  styleName: string
  blurb: string
  palette: ThemePalette
  theme: StudioTheme
}

export function themeCards(style?: ThemeStyleId): ThemeCard[] {
  return (style ? [style] : THEME_STYLES).flatMap(s =>
    THEME_PALETTES[s].map(palette => ({ id: themeIdOf(s, palette.id), style: s, styleName: themeStyle(s).name, blurb: themeStyle(s).blurb, palette, theme: themeTokens(s, palette) }))
  )
}

/** The styles whose pages are ready for a product (pages.ts themeAvailability): how many, and which Site Builder pages. */
export type ThemeAvailable = Partial<Record<ThemeStyleId, { pages: number; keys: string[] }>>
