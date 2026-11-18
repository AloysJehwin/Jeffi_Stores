import { AsyncLocalStorage } from 'async_hooks'
import type { PageKey } from '@jeffi/site-blocks'
import type { CodeNode, CodeValue } from '../code/ast'
import type { StudioBrief } from '../studio/types'
import { INK, THEME_PALETTES, themeStyle, type ThemeStyleId } from './catalog'

// Template mode: the studio's own section writer (studio/generate.ts) writing a ready-made theme instead of one
// store's site. scripts/site-themes/generate-templates.ts runs it inside runTemplateMode; generate.ts adds
// templateRules() to the system prompts and templateLint() to the repair loop, and both are empty outside it, so the
// owner's own generations never see them.

export interface TemplateMode {
  style: ThemeStyleId
  product: 'store' | 'showcase'
}

const mode = new AsyncLocalStorage<TemplateMode>()

export const runTemplateMode = <T>(m: TemplateMode, fn: () => Promise<T>): Promise<T> => mode.run(m, fn)
export const templateMode = (): TemplateMode | null => mode.getStore() ?? null

/** The neutral brief's name and lines: the model must never type them (templateLint finds them). */
export const PLACEHOLDER = {
  store: 'Placeholder Store',
  showcase: 'Placeholder Studio',
  tagline: 'Placeholder tagline',
  about: 'Placeholder story about the business.',
} as const

/** The brief a template is written from: a placeholder business with nothing specific to copy. */
export function templateBrief(style: ThemeStyleId, product: TemplateMode['product'], seed: number): StudioBrief {
  const st = themeStyle(style)
  const showcase = product === 'showcase'
  return {
    storeName: showcase ? PLACEHOLDER.showcase : PLACEHOLDER.store,
    summary: showcase
      ? 'A ready-made one-page website shared by many Indian businesses and professionals; each fills in its own name, work and contacts.'
      : 'A ready-made theme shared by many Indian online stores of every kind; each fills in its own name, story and catalogue.',
    category: showcase ? 'any profession or local business' : 'any category: fashion, electronics, groceries, beauty, books, home, auto parts and more',
    vocabulary: [],
    audience: showcase ? 'clients of any local business across India' : 'shoppers across India',
    priceTier: 'mid',
    voice: 'warm, clear and brief',
    mood: `${st.name.toLowerCase()}: ${st.blurb.toLowerCase()}`,
    artDirection: 'Pictures come from the store itself',
    references: [],
    uiStyle: style,
    logoUrl: null,
    tagline: PLACEHOLDER.tagline,
    about: PLACEHOLDER.about,
    seed,
    ...(showcase ? { kind: 'showcase' as const } : {}),
  }
}

const SHARED = [
  'TEMPLATE MODE. You are writing a ready-made theme, not one business\'s site: the same code is installed by many different businesses and worn in five colour palettes. The brief\'s name, tagline and story are placeholders: never type them.',
  'Copy you write must suit any business: short, generic and warm ("New this week", "Shop by category", "Questions? We\'re here to help", "Made to be used every day"). No product types, materials, categories, professions, places, numbers, prices, claims, promises, guarantees, awards or invented facts. Let the data speak instead.',
  'Colours only through theme tokens (the primary-, accent- and secondary- scales, the surface, foreground and border tokens, white and black). Never a named Tailwind colour (gray, slate, red, blue…) or an arbitrary one (bg-[#…]).',
  'Text on a fill goes by its shade: light text (text-white) on the 700, 800 and 900 shades, dark text (text-secondary-900) on the 50 to 400 shades. On the 500 and 600 fills write text-white: the store\'s stylesheet makes it white or near-black, whichever reads on the palette.',
]

const STORE_ONLY =
  "The store's name, tagline, story, logo and contact details only through <Store>{s => …}</Store> (s.name, s.tagline, s.about, s.logo, s.phone, s.email, s.address, s.whatsapp) and <Logo />; guard the optional ones ({s.tagline && …}, {s.about && …}). Products, categories, brands, reviews and offers only through their data components."

const SHOWCASE_ONLY =
  "The business's name, tagline, profession, story, logo, contacts, hours and address only through <Business>{b => …}</Business>, guarded ({b.tagline && …}, {b.about && …}); services, work, testimonials, numbers and questions only through their parts."

/** The extra system-prompt rules for this page in template mode; empty outside it. */
export function templateRules(page: PageKey | string): string {
  const m = templateMode()
  if (!m) return ''
  const st = themeStyle(m.style)
  const palettes = THEME_PALETTES[m.style].map(p => p.name).join(', ')
  // The product card reads only its product (p), so it gets no store-data rule.
  const data = page === 'card' ? [] : [m.product === 'showcase' || page === 'showcase' ? SHOWCASE_ONLY : STORE_ONLY]
  return `\n\n${[
    ...SHARED,
    ...data,
    `This is the ${st.name} theme; it is worn in the palettes ${palettes}, so design with the colour roles below, never with one palette's hues. ${INK[m.style].rule}`,
  ].join('\n')}`
}

// ── Lint: what a template must not carry ─────────────────────────────────────────────────────────────

const NAMED =
  /(?:^|:)(?:bg|text|border|from|via|to|ring|fill|stroke|divide|outline|decoration|shadow|accent|caret|placeholder|ring-offset)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?:\/\d+)?$/
const ARBITRARY = /-\[(?:#|rgb|hsl|oklch|color|var\()/i

const NOTES = {
  placeholder: "Do not type the store's name, tagline or story (the brief's are placeholders): use <Store>{s => …}</Store> (<Business>{b => …}</Business> on a Showcase page).",
  colour: 'Use theme colours only: the primary-, accent- and secondary- scales, surface, foreground and border tokens, white and black. No named Tailwind colours (gray, red, blue…) and no arbitrary colours.',
} as const

const literalStrings = (v: unknown, out: string[], depth = 0): void => {
  if (typeof v === 'string') out.push(v)
  else if (v && typeof v === 'object' && depth < 8) for (const x of Array.isArray(v) ? v : Object.values(v)) literalStrings(x, out, depth + 1)
}

/** Every literal string a value can take (both sides of a ternary, every part of a template literal, list items). */
function strings(v: CodeValue | undefined, out: string[] = []): string[] {
  if (!v) return out
  switch (v.k) {
    case 'lit':
      literalStrings(v.v, out)
      break
    case 'tpl':
      for (const p of v.parts) typeof p === 'string' ? out.push(p) : strings(p, out)
      break
    case 'cond':
      strings(v.then, out)
      strings(v.else, out)
      break
    case 'obj':
      Object.values(v.v).forEach(x => strings(x, out))
      break
    case 'arr':
      v.v.forEach(x => strings(x, out))
      break
  }
  return out
}

/** What a template section still carries that would not fit every store (repair notes; none outside template mode). */
export function templateLint(ast: unknown, _page?: PageKey | string): string[] {
  if (!templateMode()) return []
  const found = new Set<string>()
  const names = Object.values(PLACEHOLDER).map(s => s.toLowerCase())
  const text = (s: unknown) => {
    if (typeof s === 'string' && names.some(n => s.toLowerCase().includes(n))) found.add(NOTES.placeholder)
  }
  const classes = (v: CodeValue | undefined) => {
    const tokens = strings(v).join(' ').split(/\s+/).filter(Boolean)
    if (tokens.some(t => NAMED.test(t) || ARBITRARY.test(t))) found.add(NOTES.colour)
  }
  const walk = (n: unknown, depth = 0) => {
    if (!n || typeof n !== 'object' || depth > 200) return
    const node = n as CodeNode
    switch (node.t) {
      case 'el':
      case 'cmp':
        for (const [k, v] of Object.entries(node.props ?? {})) {
          if (k === 'className' || k.endsWith('ClassName')) classes(v)
          else strings(v).forEach(text)
        }
        node.children?.forEach(c => walk(c, depth + 1))
        if (node.t === 'cmp' && node.render) walk(node.render.body, depth + 1)
        return
      case 'text':
        text(node.value)
        return
      case 'expr':
        strings(node.value).forEach(text)
        return
      case 'frag':
        node.children?.forEach(c => walk(c, depth + 1))
        return
      case 'cond':
        walk(node.then, depth + 1)
        walk(node.else, depth + 1)
        return
      case 'each':
        strings(node.items).forEach(text)
        walk(node.body, depth + 1)
        return
    }
  }
  walk(ast)
  return [...found]
}

/** A finished template section's source still naming the placeholder business (the generator's last check). */
export const carriesPlaceholder = (source: string) => Object.values(PLACEHOLDER).some(p => source.toLowerCase().includes(p.toLowerCase()))
