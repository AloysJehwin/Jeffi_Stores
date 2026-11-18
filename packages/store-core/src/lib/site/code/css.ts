import postcss, { type AcceptedPlugin, type Container } from 'postcss'
import preset from '../../../../tailwind.preset'
import { inertCss, safeClass } from './allow'

// A code section's Tailwind classes compiled at save time with the shared preset (so theme colours and fonts resolve
// to the store's CSS variables) and every rule scoped under the section's wrapper. No preflight and no base layer: the
// app's stylesheet already has them, and a base layer here would reset the theme variables inside the section.

type TailwindPlugin = (config: Record<string, unknown>) => AcceptedPlugin
let tailwind: TailwindPlugin | null = null
const loadTailwind = async (): Promise<TailwindPlugin> => {
  if (!tailwind) {
    const mod = (await import('tailwindcss')) as unknown as { default?: TailwindPlugin }
    tailwind = (mod.default ?? mod) as TailwindPlugin
  }
  return tailwind
}

/** `cs-1a2b3c4d` → `[data-code-section="cs-1a2b3c4d"]`; a selector is kept as given. */
export const scopeSelector = (scope: string) => (/^[[.#]/.test(scope) ? scope : `[data-code-section="${scope.replace(/[^A-Za-z0-9_-]/g, '')}"]`)

/**
 * A site card's scope (its wrapper's `data-site-card`), written twice: a card sits inside sections whose own rules also
 * reach it, and the doubled selector lets the card's rules win over theirs whatever order the styles load in.
 */
export const cardScope = (id: string) => {
  const one = `[data-site-card="${id.replace(/[^A-Za-z0-9_-]/g, '')}"]`
  return one + one
}

const inKeyframes = (node: { parent?: Container | { parent?: unknown } | undefined }) => {
  for (let p = node.parent as (Container & { name?: string }) | undefined; p; p = p.parent as typeof p)
    if (p.type === 'atrule' && /keyframes$/i.test(p.name ?? '')) return true
  return false
}

// group and peer style nothing themselves: other classes' selectors read them.
const MARKER = /^(group|peer)(\/[\w-]+)?$/

/** The classes of a section that its compiled CSS has no rule for: not Tailwind classes this theme has, so inert. */
export function deadClasses(classes: string[], css: string): string[] {
  const seen = new Set<string>()
  for (const m of css.matchAll(/\.((?:\\[0-9a-fA-F]{1,6} ?|\\.|[\w-])+)/g))
    seen.add(m[1].replace(/\\([0-9a-fA-F]{1,6}) ?|\\(.)/g, (_, hex: string | undefined, ch: string | undefined) => (hex ? String.fromCodePoint(parseInt(hex, 16)) : (ch ?? ''))))
  return classes.filter(c => safeClass(c) && !MARKER.test(c) && !seen.has(c))
}

export async function compileSectionCss(classes: string[], scope: string): Promise<string> {
  const list = [...new Set(classes)].filter(safeClass)
  if (!list.length) return ''
  const plugin = await loadTailwind()
  const result = await postcss([
    plugin({ presets: [preset], content: [{ raw: list.join(' '), extension: 'html' }], corePlugins: { preflight: false }, safelist: [] }),
  ]).process('@tailwind components;\n@tailwind utilities;', { from: undefined })
  const sel = scopeSelector(scope)
  result.root.walkComments(c => {
    c.remove()
  })
  result.root.walkRules(rule => {
    if (!inKeyframes(rule)) rule.selectors = rule.selectors.map(s => `${sel} ${s}`)
  })
  return inertCss(result.root.toString().replace(/\n\s*/g, ''))
}
