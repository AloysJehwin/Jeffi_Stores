import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import {
  SECTION_SKELETONS,
  SectionSkeleton,
  groupLayoutRows,
  HomeLayoutSkeleton,
  ListingSectionSkeleton,
  listingInserts,
} from '@/components/visitor/skeletons/sections'

const sec = (type: string, side = 'full', after?: number) => ({ type, side, after }) as any
const HIDDEN = ['featured_for_you', 'recently_viewed', 'back_in_stock']

describe('SECTION_SKELETONS', () => {
  it.each(Object.keys(SECTION_SKELETONS))('%s draws a placeholder (or stays hidden for data-only sections)', type => {
    const { container } = render(<SectionSkeleton type={type as any} />)
    if (HIDDEN.includes(type)) expect(container).toBeEmptyDOMElement()
    else expect(container.querySelector('.sk, section, div')).not.toBeNull()
  })

  it('renders nothing for an unknown type', () => {
    const { container } = render(<SectionSkeleton type={'not_a_type' as any} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('groupLayoutRows', () => {
  it('pairs a left with the right that follows and leaves the rest alone', () => {
    const rows = groupLayoutRows([sec('a', 'left'), sec('b', 'right'), sec('c', 'full'), sec('d', 'right'), sec('e', 'left')])
    expect(rows.map(r => r.map(s => s.type))).toEqual([['a', 'b'], ['c'], ['d'], ['e']])
  })

  it('returns [] for no sections', () => {
    expect(groupLayoutRows([])).toEqual([])
  })
})

describe('HomeLayoutSkeleton', () => {
  it('is a busy status with the default or a custom label', () => {
    const a = render(<HomeLayoutSkeleton sections={[sec('hero')]} />)
    expect(screen.getByRole('status', { name: 'Loading home' })).toHaveAttribute('aria-busy', 'true')
    a.unmount()
    render(<HomeLayoutSkeleton sections={[sec('hero')]} label="Loading business home" />)
    expect(screen.getByRole('status', { name: 'Loading business home' })).toBeInTheDocument()
  })

  it('puts a left/right pair side by side in one row', () => {
    const { container } = render(<HomeLayoutSkeleton sections={[sec('trust_strip', 'left'), sec('about', 'right'), sec('hero')]} />)
    const root = container.firstChild as HTMLElement
    expect(root.childNodes).toHaveLength(2)
    expect((root.firstChild as HTMLElement).childNodes).toHaveLength(2)
  })
})

describe('ListingSectionSkeleton', () => {
  it('wraps a lone section across the grid', () => {
    const { container } = render(<ListingSectionSkeleton section={sec('trust_strip')} />)
    expect(container.firstChild).toHaveClass('col-span-full')
    expect((container.firstChild as HTMLElement).childNodes).toHaveLength(1)
  })

  it('renders the pair in two cells', () => {
    const { container } = render(<ListingSectionSkeleton section={sec('trust_strip', 'left')} partner={sec('about', 'right')} />)
    expect(container.firstChild).toHaveClass('col-span-full')
    expect((container.firstChild as HTMLElement).childNodes).toHaveLength(2)
  })
})

describe('listingInserts', () => {
  it('defaults to 6 cards and no inserts for no sections', () => {
    expect(listingInserts([])).toEqual({ count: 6, inserts: [] })
  })

  it('places sections after their Nth card, sorted, and grows the grid to reach the last', () => {
    const r = listingInserts([sec('about', 'full', 10), sec('trust_strip', 'full', 2)])
    expect(r.inserts.map(i => i.at)).toEqual([2, 10])
    expect(r.count).toBe(14)
  })

  it('pairs left/right sections into one insert and skips ones past the page size', () => {
    const r = listingInserts([sec('trust_strip', 'left', 3), sec('about', 'right', 3), sec('hero', 'full', 99)], { pageSize: 60 })
    expect(r.inserts).toHaveLength(1)
    expect(r.inserts[0].at).toBe(3)
    expect(r.count).toBe(7)
  })

  it('treats a missing "after" as 0 and caps growth at the page size', () => {
    const r = listingInserts([sec('about', 'full', 58), sec('trust_strip')], { count: 2, pageSize: 60 })
    expect(r.inserts.map(i => i.at)).toEqual([0, 58])
    expect(r.count).toBe(60)
  })
})
