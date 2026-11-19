import postcss, { type AcceptedPlugin, type Container } from 'postcss'
import selectorParser from 'postcss-selector-parser'
import preset from '../../../../tailwind.preset'
import { inertCss, safeClass } from './allow'

// A code section's Tailwind classes compiled at save time with the shared preset (so theme colours and fonts resolve
// to the store's CSS variables) and every rule scoped under the section's wrapper. No preflight and no base layer: the
// app's stylesheet already has them, and a base layer here would reset the theme variables inside the section.

/**
 * A section's (or card's) mark: its own id as a class, on every element it styled (the tags it wrote, and the element
 * that gets a className or itemClassName… it passed to a part). Each of its rules asks for it, so they reach neither
 * the parts' own markup (where a scoped `.flex` (0,2,0) beat the app's `lg:hidden` (0,1,0)) nor a section drawn inside.
 */
export const codeMark = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '')

/** Leads CSS whose rules ask for the mark; stored CSS in an earlier format is upgraded at render (currentCss). */
export const CSS_FORMAT = '/*cs:3*/'
const OLD_FORMAT = /^\/\*cs:\d+\*\//
// The one mark every section shared in format 2.
const SHARED_MARK = 'cs-own'

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

/** The id a scope names: the scope itself, or the one in its `[data-code-section="…"]` or `[data-site-card="…"]`. */
const scopeId = (scope: string) => (/^[[.#]/.test(scope) ? (/data-(?:code-section|site-card)="([^"]*)"/.exec(scope)?.[1] ?? '') : scope)

/** A site card's scope (its wrapper's `data-site-card`), written twice so its rules outrank a section's in any order. */
export const cardScope = (id: string) => {
  const one = `[data-site-card="${id.replace(/[^A-Za-z0-9_-]/g, '')}"]`
  return one + one
}

const inKeyframes = (node: { parent?: Container | { parent?: unknown } | undefined }) => {
  for (let p = node.parent as (Container & { name?: string }) | undefined; p; p = p.parent as typeof p)
    if (p.type === 'atrule' && /keyframes$/i.test(p.name ?? '')) return true
  return false
}

/**
 * The mark added to the compound holding the rule's own class: the longest one, since a variant's classes (group, peer,
 * dark, `[.x_&]`) are spelt inside it. `.group:hover .group-hover\:x` → `.group:hover .group-hover\:x.cs-1a2b3c4d`.
 * A mark already there (this one, or format 2's shared `cs-own`) is replaced.
 */
export function markSelector(selector: string, mark: string): string {
  if (!mark) return selector
  try {
    return selectorParser(root => {
      const all: selectorParser.ClassName[] = []
      root.walkClasses(c => {
        all.push(c)
      })
      const found = all.filter(c => c.value !== mark && c.value !== SHARED_MARK)
      for (const c of all) if (!found.includes(c)) c.remove()
      const own = found.reduce((a, c) => (c.value.length > a.length ? c.value : a), '')
      for (const c of found) if (c.value === own) c.parent?.insertAfter(c, selectorParser.className({ value: mark }))
    }).processSync(selector)
  } catch {
    return selector
  }
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

/** `mark`: the section's id (codeMark); by default the id the scope names. */
export async function compileSectionCss(classes: string[], scope: string, mark?: string): Promise<string> {
  const list = [...new Set(classes)].filter(safeClass)
  if (!list.length) return ''
  const plugin = await loadTailwind()
  const result = await postcss([
    plugin({ presets: [preset], content: [{ raw: list.join(' '), extension: 'html' }], corePlugins: { preflight: false }, safelist: [] }),
  ]).process('@tailwind components;\n@tailwind utilities;', { from: undefined })
  const sel = scopeSelector(scope)
  const own = codeMark(mark ?? scopeId(scope))
  result.root.walkComments(c => {
    c.remove()
  })
  result.root.walkRules(rule => {
    if (!inKeyframes(rule)) rule.selectors = rule.selectors.map(s => `${sel} ${markSelector(s, own)}`)
  })
  const css = result.root.toString().replace(/\n\s*/g, '')
  return css ? CSS_FORMAT + inertCss(css) : ''
}

const upgraded = new Map<string, string>()
const UPGRADED_MAX = 500

const fnv = (s: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * A stored section's (or card's) CSS in the current format: CSS saved in an earlier one gets the section's mark (its
 * `id`) on its own rules, the rest kept as saved, once per process (keyed by the id and a hash of the CSS). Sites built
 * before need no rebuild.
 */
export function currentCss(css: unknown, id = ''): string {
  if (typeof css !== 'string') return ''
  if (!css || css.startsWith(CSS_FORMAT)) return css
  const key = `${id}:${css.length}:${fnv(css)}`
  let out = upgraded.get(key)
  if (out === undefined) {
    const mark = codeMark(id || (/data-(?:code-section|site-card)="([^"]*)"/.exec(css)?.[1] ?? ''))
    try {
      const root = postcss.parse(css.replace(OLD_FORMAT, ''))
      root.walkRules(rule => {
        if (!inKeyframes(rule)) rule.selectors = rule.selectors.map(s => markSelector(s, mark))
      })
      out = mark ? CSS_FORMAT + root.toString() : css
    } catch {
      out = css
    }
    if (upgraded.size >= UPGRADED_MAX) upgraded.delete(upgraded.keys().next().value as string)
    upgraded.set(key, out)
  }
  return out
}
