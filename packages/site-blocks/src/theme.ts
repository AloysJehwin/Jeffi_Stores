// A store's theme: brand colours, a font pair from a fixed list (so pages only ever load known Google fonts), corner
// radius, button style and spacing, plus optional style tokens for the pages that take the theme. Rendered as CSS
// variables the storefront's Tailwind colours and ui-* hook classes read.

export type Radius = 'none' | 'sm' | 'md' | 'lg' | 'full'
export type ButtonStyle = 'solid' | 'outline' | 'pill'
export type Density = 'compact' | 'comfortable' | 'airy'
export type ButtonShape = 'square' | 'rounded' | 'pill'
export type CardStyle = 'flat' | 'outlined' | 'shadow'
export type InputStyle = 'outlined' | 'filled' | 'underline'
export type HeadingCase = 'normal' | 'upper'
export type HeadingTracking = 'tight' | 'normal' | 'wide'
export type ShadowDepth = 'none' | 'soft' | 'strong'

/** Style tokens for the pages that take the theme rather than an AI design (account, orders, sign-in, legal…). */
export interface ThemeStyle {
  buttonShape: ButtonShape
  cardStyle: CardStyle
  inputStyle: InputStyle
  headingCase: HeadingCase
  headingTracking: HeadingTracking
  shadow: ShadowDepth
}

export const STYLE_CHOICES: { [K in keyof ThemeStyle]: readonly ThemeStyle[K][] } = {
  buttonShape: ['square', 'rounded', 'pill'],
  cardStyle: ['flat', 'outlined', 'shadow'],
  inputStyle: ['outlined', 'filled', 'underline'],
  headingCase: ['normal', 'upper'],
  headingTracking: ['tight', 'normal', 'wide'],
  shadow: ['none', 'soft', 'strong'],
}

/** Style tokens are optional: an unset one leaves those pages exactly as they are built. */
export interface ThemeTokens extends Partial<ThemeStyle> {
  primary: string
  accent: string
  neutral: string
  fontDisplay: string
  fontBody: string
  radius: Radius
  buttonStyle: ButtonStyle
  density: Density
}

export const FONT_CHOICES: { name: string; kind: 'sans' | 'serif' | 'display'; weights: string }[] = [
  { name: 'Inter', kind: 'sans', weights: '400;500;600;700' },
  { name: 'Poppins', kind: 'sans', weights: '400;500;600;700' },
  { name: 'Montserrat', kind: 'sans', weights: '400;500;600;700' },
  { name: 'DM Sans', kind: 'sans', weights: '400;500;700' },
  { name: 'Manrope', kind: 'sans', weights: '400;500;600;700' },
  { name: 'Plus Jakarta Sans', kind: 'sans', weights: '400;500;600;700' },
  { name: 'Josefin Sans', kind: 'sans', weights: '400;600;700' },
  { name: 'Space Grotesk', kind: 'sans', weights: '400;500;700' },
  { name: 'Space Mono', kind: 'sans', weights: '400;700' },
  { name: 'Rubik', kind: 'sans', weights: '400;500;600;700' },
  { name: 'Nunito', kind: 'sans', weights: '400;600;700' },
  { name: 'Lato', kind: 'sans', weights: '400;700' },
  { name: 'Raleway', kind: 'sans', weights: '400;600;700' },
  { name: 'Work Sans', kind: 'sans', weights: '400;500;600;700' },
  { name: 'Jost', kind: 'sans', weights: '400;500;600;700' },
  { name: 'Playfair Display', kind: 'serif', weights: '400;600;700' },
  { name: 'DM Serif Display', kind: 'serif', weights: '400' },
  { name: 'Cormorant Garamond', kind: 'serif', weights: '400;500;600;700' },
  { name: 'Lora', kind: 'serif', weights: '400;500;600;700' },
  { name: 'Libre Baskerville', kind: 'serif', weights: '400;700' },
  { name: 'Marcellus', kind: 'serif', weights: '400' },
  { name: 'Cinzel', kind: 'display', weights: '400;600;700' },
  { name: 'Bebas Neue', kind: 'display', weights: '400' },
  { name: 'Oswald', kind: 'display', weights: '400;500;600;700' },
  { name: 'Archivo Black', kind: 'display', weights: '400' },
]

export const DEFAULT_THEME: ThemeTokens = {
  primary: '#f59e0b',
  accent: '#7cb900',
  neutral: '#363948',
  fontDisplay: 'Bebas Neue',
  fontBody: 'Inter',
  radius: 'md',
  buttonStyle: 'solid',
  density: 'comfortable',
}

const HEX = /^#[0-9a-f]{6}$/i
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d)
const font = (v: unknown, d: string) => (FONT_CHOICES.some(f => f.name === v) ? (v as string) : d)

export function normalizeTheme(t?: Partial<ThemeTokens> | null): ThemeTokens {
  const d = DEFAULT_THEME
  const hex = (v: unknown, def: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : def)
  const out: ThemeTokens = {
    primary: hex(t?.primary, d.primary),
    accent: hex(t?.accent, d.accent),
    neutral: hex(t?.neutral, d.neutral),
    fontDisplay: font(t?.fontDisplay, d.fontDisplay),
    fontBody: font(t?.fontBody, d.fontBody),
    radius: oneOf(t?.radius, ['none', 'sm', 'md', 'lg', 'full'] as const, d.radius),
    buttonStyle: oneOf(t?.buttonStyle, ['solid', 'outline', 'pill'] as const, d.buttonStyle),
    density: oneOf(t?.density, ['compact', 'comfortable', 'airy'] as const, d.density),
  }
  // Valid style tokens are kept; anything else is dropped, so the key stays absent (never undefined).
  for (const k of Object.keys(STYLE_CHOICES) as (keyof ThemeStyle)[]) {
    const v = t?.[k]
    if ((STYLE_CHOICES[k] as readonly unknown[]).includes(v)) Object.assign(out, { [k]: v })
  }
  return out
}

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const toHex = (c: number[]) => `#${c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t)

export const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const
const STEP: Record<(typeof SHADES)[number], number> = { 50: 0.92, 100: 0.82, 200: 0.64, 300: 0.44, 400: 0.22, 500: 0, 600: -0.16, 700: -0.32, 800: -0.48, 900: -0.62 }

/** A 50–900 scale around a brand colour (500 is the colour itself). */
export function paletteFrom(hex: string): Record<(typeof SHADES)[number], string> {
  const base = rgb(hex)
  return Object.fromEntries(
    SHADES.map(s => [s, toHex(STEP[s] >= 0 ? mix(base, [255, 255, 255], STEP[s]) : mix(base, [0, 0, 0], -STEP[s]))])
  ) as Record<(typeof SHADES)[number], string>
}

const RADIUS: Record<Radius, string> = { none: '0px', sm: '6px', md: '12px', lg: '20px', full: '28px' }
const BUTTON_RADIUS: Record<ButtonStyle, string | null> = { solid: null, outline: null, pill: '999px' }
const SPACE: Record<Density, string> = { compact: '0.75', comfortable: '1', airy: '1.35' }

const luminance = (hex: string) =>
  rgb(hex)
    .map(v => v / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
const INK_DARK = '#111827'
/** The text colour that reads best on a fill: white, or the near-black globals.css has always put on brand fills. */
function inkOn(hex: string): string {
  const l = luminance(hex) + 0.05
  return 1.05 / l >= l / (luminance(INK_DARK) + 0.05) ? '#ffffff' : INK_DARK
}

/** The CSS variables a theme sets: Tailwind colour channels (`--c-<name>-<shade>`), the legacy brand variables, fonts and shape. */
export function themeCssVars(theme: ThemeTokens): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [name, hex] of [['primary', theme.primary], ['accent', theme.accent], ['secondary', theme.neutral]] as const) {
    const scale = paletteFrom(hex)
    for (const s of SHADES) vars[`--c-${name}-${s}`] = rgb(scale[s]).join(' ')
    if (name !== 'secondary') {
      vars[`--${name}-500`] = scale[500]
      vars[`--${name}-600`] = scale[600]
      // text-white on these fills (globals.css): white on a dark brand colour, near-black on a light one.
      vars[`--on-${name}-500`] = inkOn(scale[500])
      vars[`--on-${name}-600`] = inkOn(scale[600])
    }
  }
  vars['--font-display'] = `'${theme.fontDisplay}'`
  vars['--font-body'] = `'${theme.fontBody}'`
  vars['--radius-card'] = RADIUS[theme.radius]
  vars['--radius-button'] = BUTTON_RADIUS[theme.buttonStyle] ?? RADIUS[theme.radius === 'full' ? 'lg' : theme.radius]
  vars['--space-scale'] = SPACE[theme.density]
  Object.assign(vars, styleCssVars(theme))
  return vars
}

// Controls (buttons, fields) at the theme's corner size; md is the 8px the pages are built with.
const CONTROL_RADIUS: Record<Radius, string> = { none: '0px', sm: '4px', md: '8px', lg: '12px', full: '16px' }
const SHADOW: Record<ShadowDepth, { card: string; raised: string }> = {
  none: { card: 'none', raised: 'none' },
  soft: { card: '0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.06)', raised: '0 10px 25px -5px rgb(0 0 0 / 0.12), 0 8px 10px -6px rgb(0 0 0 / 0.08)' },
  strong: { card: '0 8px 24px -6px rgb(0 0 0 / 0.2), 0 2px 6px -2px rgb(0 0 0 / 0.12)', raised: '0 25px 50px -12px rgb(0 0 0 / 0.35)' },
}
const TRACKING: Record<HeadingTracking, string> = { tight: '-0.02em', normal: '0em', wide: '0.06em' }

/**
 * The `--ui-*` variables the style tokens set, read by the `ui-*` hook classes in store-core's globals.css. A token
 * that is unset sets nothing, so every hook falls back to the utility it sits beside and the page looks as built.
 */
export function styleCssVars(theme: ThemeTokens): Record<string, string> {
  const vars: Record<string, string> = {}
  const control = CONTROL_RADIUS[theme.radius]
  if (theme.buttonShape) {
    const b = theme.buttonShape
    vars['--ui-btn-radius'] = b === 'square' ? '0px' : b === 'pill' ? '999px' : control
    vars['--ui-badge-radius'] = b === 'square' ? '2px' : b === 'pill' ? '999px' : '6px'
  }
  if (theme.cardStyle) {
    vars['--ui-card-radius'] = RADIUS[theme.radius]
    vars['--ui-card-border-width'] = theme.cardStyle === 'outlined' ? '1px' : '0px'
    // A card that is borderless by design (the product card on phones) shows its edge when cards are outlined.
    vars['--ui-card-border'] = theme.cardStyle === 'outlined' ? 'var(--color-border)' : 'transparent'
    vars['--ui-card-shadow'] = theme.cardStyle === 'shadow' ? SHADOW[theme.shadow ?? 'soft'].card : 'none'
    if (theme.cardStyle === 'flat') vars['--ui-card-bg'] = 'var(--color-surface-secondary)'
  }
  if (theme.shadow) {
    vars['--ui-shadow'] = SHADOW[theme.shadow].card
    vars['--ui-shadow-raised'] = SHADOW[theme.shadow].raised
  }
  if (theme.inputStyle) {
    const s = theme.inputStyle
    vars['--ui-input-radius'] = s === 'underline' ? '0px' : control
    vars['--ui-input-bg'] = s === 'filled' ? 'var(--color-surface-secondary)' : s === 'underline' ? 'transparent' : 'var(--color-surface)'
    vars['--ui-input-border'] = s === 'filled' ? 'transparent' : 'var(--color-border-secondary)'
    vars['--ui-input-border-width'] = s === 'underline' ? '0 0 1px' : '1px'
    if (s === 'underline') vars['--ui-addon-border-width'] = '0 0 1px'
  }
  if (theme.headingCase || theme.headingTracking) {
    vars['--ui-heading-font'] = `'${theme.fontDisplay}', Georgia, serif`
    // A display face with no bold (Bebas Neue, Marcellus…) stays at its own weight instead of a smeared fake bold.
    if (!FONT_CHOICES.find(f => f.name === theme.fontDisplay)?.weights.includes('700')) vars['--ui-heading-weight'] = '400'
  }
  if (theme.headingCase) vars['--ui-heading-case'] = theme.headingCase === 'upper' ? 'uppercase' : 'none'
  if (theme.headingTracking) vars['--ui-heading-tracking'] = TRACKING[theme.headingTracking]
  return vars
}

/** The Google Fonts stylesheet for the theme's two fonts. */
export function googleFontsHref(theme: ThemeTokens): string {
  const fams = [...new Set([theme.fontDisplay, theme.fontBody])].map(name => {
    const f = FONT_CHOICES.find(x => x.name === name)!
    return `family=${encodeURIComponent(f.name).replace(/%20/g, '+')}:wght@${f.weights}`
  })
  return `https://fonts.googleapis.com/css2?${fams.join('&')}&display=swap`
}

export const cssVarsRule = (selector: string, vars: Record<string, string>) =>
  `${selector}{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}}`
