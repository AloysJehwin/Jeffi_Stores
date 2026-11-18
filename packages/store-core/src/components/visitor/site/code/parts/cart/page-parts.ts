import { blockVisible, topBlocks, type PageDoc } from '@jeffi/site-blocks'

/**
 * The library components a page's shown AI code sections use, or null when it has none (a built-in or block page).
 * Read from each section's compiled list, and from its source as a backstop, so a page is never left without the part
 * it needs to work (the caller then falls back to the built-in page part).
 */
export function codeComponents(doc: PageDoc, now = Date.now()): Set<string> | null {
  const sections = topBlocks(doc).filter(b => b.type === 'code_section' && blockVisible(b, now))
  if (!sections.length) return null
  const names = new Set<string>()
  for (const b of sections) {
    const compiled = (b.props as { compiled?: { components?: unknown } }).compiled
    if (Array.isArray(compiled?.components)) for (const n of compiled.components) if (typeof n === 'string') names.add(n)
    const source = typeof b.props.source === 'string' ? b.props.source : ''
    for (const m of source.matchAll(/<([A-Z][A-Za-z0-9]*)/g)) names.add(m[1])
  }
  return names
}

export const hasBlock = (doc: PageDoc, type: string) => topBlocks(doc).some(b => b.type === type)
