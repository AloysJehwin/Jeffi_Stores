import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'fs'
import { join } from 'path'
import SectionRenderer, { type SectionData } from '@/components/visitor/home/SectionRenderer'
import { visibleSections, withDefaults, DEFAULT_SECTIONS, type HomepageSection } from '@/lib/catalog/homepage-sections'

afterEach(cleanup)

const SNAPSHOT = join(process.cwd(), 'tests/fixtures/homepage-sections.json')

const EMPTY: SectionData = {
  heroSlides: [],
  mainCategories: [],
  topBrands: [],
  categoryShowcase: [],
  dealOfTheDay: [],
  offers: [],
  productRows: new Map(),
  freeShippingThreshold: 0,
  gstEnabled: false,
  stats: [],
  aboutCopy: '',
  storeName: 'Test',
  businessLandingUrl: '/b',
  businessSignupUrl: '/s',
  extras: new Map(),
}

function liveRows(): HomepageSection[] {
  return JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
}

describe('why_us renders from the seeded rows', () => {
  it('survives visibleSections with the real seeded data', () => {
    const visible = visibleSections(withDefaults(liveRows()))
    expect(visible.map(s => s.type)).toContain('why_us')
  })

  it('places why_us between benefits and about, matching DEFAULT_SECTIONS', () => {
    const order = visibleSections(withDefaults(liveRows())).map(s => s.type)
    expect(order).toEqual(DEFAULT_SECTIONS.map(s => s.type))
  })

  it('renders the configured heading rather than a blank section', () => {
    const why = visibleSections(withDefaults(liveRows())).find(s => s.type === 'why_us')!
    render(<SectionRenderer section={why} data={EMPTY} rowIndex={0} />)
    expect(screen.getByText('Built for Industry')).toBeTruthy()
  })

  it('falls back to built-in tiles when config has no items', () => {
    const why = visibleSections(withDefaults(liveRows())).find(s => s.type === 'why_us')!
    expect(why.config.items).toBeUndefined()
    const { container } = render(<SectionRenderer section={why} data={EMPTY} rowIndex={0} />)
    expect(container.textContent).not.toBe('')
  })
})
