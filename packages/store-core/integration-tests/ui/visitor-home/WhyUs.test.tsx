import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import WhyUs from '@/components/visitor/home/WhyUs'
import { copyDefaultsFor, tileDefaultsFor } from '@/lib/catalog/homepage-sections'

// WhyUs: three value tiles with color-keyed icon chips. Falls back to flagship copy + tiles.

describe('WhyUs (render)', () => {
  it('renders passed items with title/desc', () => {
    render(
      <WhyUs
        title="Our promise"
        eyebrow="Trust"
        items={[
          { icon: 'Award', title: 'Quality first', desc: 'Checked by hand', color: 'primary' },
          { icon: 'Zap', title: 'Fast ship', desc: 'Out same day', color: 'accent' },
        ]}
      />
    )
    expect(screen.getByRole('heading', { name: 'Our promise' })).toBeInTheDocument()
    expect(screen.getByText('Trust')).toBeInTheDocument()
    expect(screen.getByText('Quality first')).toBeInTheDocument()
    expect(screen.getByText('Checked by hand')).toBeInTheDocument()
    expect(screen.getByText('Fast ship')).toBeInTheDocument()
  })

  it('uses flagship default copy + tiles when none passed', () => {
    render(<WhyUs />)
    const copy = copyDefaultsFor('why_us', true)
    const tiles = (tileDefaultsFor('why_us', true) ?? []) as { title: string }[]
    expect(screen.getByRole('heading', { name: copy.title! })).toBeInTheDocument()
    expect(tiles.length).toBeGreaterThan(0)
    expect(screen.getByText(tiles[0].title)).toBeInTheDocument()
  })
})
