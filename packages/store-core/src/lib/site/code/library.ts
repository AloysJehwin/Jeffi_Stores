import { z } from 'zod'
import type { PageKey } from '@jeffi/site-blocks'
import { REGISTRY, type CodeComponentDef } from './registry'
import { LIBRARY_MODULE, codeRules } from './allow'
import './parts'

// The component library the AI may use in code sections. Each part module (./parts) registers its components with
// defineCodeComponent when it loads; importing this module loads them all.

export { defineCodeComponent, type CodeComponentDef, type RenderCtx } from './registry'
export { codeRules, LIBRARY_MODULE }

export function codeLibrary(): Map<string, CodeComponentDef> {
  return REGISTRY
}

/** What a site card (the `card` page) may use: pictures, links, icons and the card parts. No store data, so no card in a card. */
export const CARD_PARTS = new Set(['Image', 'Link', 'Icon', 'QuickAdd', 'WishlistToggle', 'PriceTag', 'DiscountBadge', 'StockBadge', 'RatingStars'])

/** What a Showcase page may use besides its own parts (parts/showcase.tsx): decoration only, no shop part. */
export const SHOWCASE_DECOR = new Set(['Image', 'Link', 'Icon', 'Carousel', 'Tabs', 'Tab', 'Accordion', 'AccordionItem', 'Marquee', 'Reveal', 'Countdown'])

export const allowedOnPage = (def: CodeComponentDef, page: PageKey | null | undefined) =>
  page === 'card'
    ? CARD_PARTS.has(def.name)
    : page === 'showcase'
      ? def.pages === 'any'
        ? SHOWCASE_DECOR.has(def.name)
        : def.pages.includes(page)
      : def.pages === 'any' || !page || def.pages.includes(page)

/** A compact type for one JSON-schema property, for the prompt. */
function typeText(s: Record<string, any> | undefined, depth = 0): string {
  if (!s || typeof s !== 'object') return 'any'
  if (Array.isArray(s.enum)) return s.enum.map((v: unknown) => JSON.stringify(v)).join(' | ')
  if ('const' in s) return JSON.stringify(s.const)
  const alts = s.anyOf ?? s.oneOf
  if (Array.isArray(alts)) return alts.map((a: Record<string, any>) => typeText(a, depth)).join(' | ')
  switch (s.type) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return s.minimum != null && s.maximum != null ? `number ${s.minimum}–${s.maximum}` : 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    case 'array':
      return `${typeText(s.items, depth + 1)}[]`
    case 'object': {
      if (depth > 1 || !s.properties) return 'object'
      const req = new Set<string>(s.required ?? [])
      return `{ ${Object.entries(s.properties as Record<string, Record<string, any>>)
        .map(([k, v]) => `${k}${req.has(k) ? '' : '?'}: ${typeText(v, depth + 1)}`)
        .join('; ')} }`
    }
    default:
      return 'any'
  }
}

export function propsText(schema: z.ZodTypeAny): string {
  let json: Record<string, any>
  try {
    json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, any>
  } catch {
    return ''
  }
  const props = json.properties as Record<string, Record<string, any>> | undefined
  if (!props || !Object.keys(props).length) return ''
  const req = new Set<string>(json.required ?? [])
  return Object.entries(props)
    .map(([k, v]) => `${k}${req.has(k) && v.default === undefined ? '' : '?'}: ${typeText(v)}${v.description ? ` (${v.description})` : ''}`)
    .join('; ')
}

/** Prompt text: every component allowed on the page, with its props and render-function fields. */
export function describeLibrary(page: PageKey): string {
  const lines = [...REGISTRY.values()]
    .filter(d => allowedOnPage(d, page))
    .map(d => {
      const props = propsText(d.props)
      const binding = d.binding ? Object.entries(d.binding).map(([k, v]) => `${k} (${v})`).join(', ') : ''
      return [
        `- <${d.name}>${d.required?.includes(page) ? ' REQUIRED on this page' : ''}: ${d.describe}`,
        props ? `  props: ${props}` : '',
        binding ? `  render function {item => …}, item fields: ${binding}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    })
  return `Components (import from '${LIBRARY_MODULE}'):\n${lines.join('\n')}`
}
