import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(join(process.cwd(), 'src/components/admin/site-controls/controls.tsx'), 'utf8')
const sectionCard = src.slice(src.indexOf('export function SectionCard'), src.indexOf('export function FullSpan'))

describe('SectionCard collapse', () => {
  it('defaults to collapsed', () => {
    expect(sectionCard).toMatch(/defaultOpen\s*=\s*false/)
    expect(sectionCard).toMatch(/useState\(defaultOpen\)/)
  })

  it('exposes an accessible expand control', () => {
    expect(sectionCard).toContain('aria-expanded={open}')
    expect(sectionCard).toMatch(/<button/)
  })

  it('hides the body rather than unmounting it, to preserve the shortcut registry', () => {
    expect(sectionCard).toMatch(/!open\s*$|!open\s*\n?\s*\?\s*'hidden'/m)
    // an unmounting implementation would read `{open && (` around children
    expect(sectionCard).not.toMatch(/\{open && \(/)
    expect(sectionCard).toContain('{children}')
  })

  // Regression: `hidden={!open}` alone left every section visible, because Tailwind's
  // `grid` / `space-y-5` set `display` and beat the attribute. The layout classes must
  // therefore only be applied while open.
  it('does not apply display-setting layout classes while collapsed', () => {
    const collapsedBranch = sectionCard.slice(sectionCard.indexOf('!open'))
    const hiddenFirst = collapsedBranch.indexOf("'hidden'")
    const gridFirst = collapsedBranch.indexOf('lg:grid-cols-2')
    expect(hiddenFirst).toBeGreaterThan(-1)
    expect(hiddenFirst).toBeLessThan(gridFirst)
    expect(sectionCard).not.toContain('hidden={!open}')
  })

  it('keeps both the columns and stacked body layouts', () => {
    expect(sectionCard).toContain('lg:grid-cols-2')
    expect(sectionCard).toContain('space-y-5')
  })
})

describe('CustomerTagDefinitionsCard', () => {
  const tagCard = readFileSync(join(process.cwd(), 'src/components/admin/CustomerTagDefinitionsCard.tsx'), 'utf8')

  it('uses the shared SectionCard so it collapses with the rest', () => {
    expect(tagCard).toContain("from '@/components/admin/site-controls/controls'")
    expect(tagCard).toContain('<SectionCard')
    expect(tagCard).toContain('</SectionCard>')
  })

  it('no longer duplicates the card chrome', () => {
    expect(tagCard).not.toContain('bg-surface-elevated rounded-xl border border-border-default shadow-sm')
  })
})
