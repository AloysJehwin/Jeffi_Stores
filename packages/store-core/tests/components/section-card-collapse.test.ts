import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(join(process.cwd(), 'packages/store-core/src/components/admin/site-controls/controls.tsx'), 'utf8')
const sectionCard = src.slice(src.indexOf('export function SectionCard'), src.indexOf('export function FullSpan'))

// Site Controls is tabbed, so its sections are always open: no collapse toggle or hidden body.
describe('SectionCard', () => {
  it('has no collapse state or toggle', () => {
    expect(sectionCard).not.toMatch(/defaultOpen|useState|aria-expanded|<button/)
  })

  it('always renders its children', () => {
    expect(sectionCard).toContain('{children}')
    expect(sectionCard).not.toContain("'hidden'")
  })

  it('keeps both the columns and stacked body layouts', () => {
    expect(sectionCard).toContain('lg:grid-cols-2')
    expect(sectionCard).toContain('space-y-5')
  })
})

describe('CustomerTagDefinitionsCard', () => {
  const tagCard = readFileSync(join(process.cwd(), 'packages/store-core/src/components/admin/CustomerTagDefinitionsCard.tsx'), 'utf8')

  it('uses the shared SectionCard', () => {
    expect(tagCard).toContain("from '@/components/admin/site-controls/controls'")
    expect(tagCard).toContain('<SectionCard')
    expect(tagCard).toContain('</SectionCard>')
  })

  it('no longer duplicates the card chrome', () => {
    expect(tagCard).not.toContain('bg-surface-elevated rounded-xl border border-border-default shadow-sm')
  })
})
