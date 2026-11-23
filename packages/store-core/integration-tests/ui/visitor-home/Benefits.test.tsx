import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Benefits from '@/components/visitor/home/Benefits'
import { tileDefaultsFor } from '@/lib/catalog/homepage-sections'

// Benefits: icon tiles. Renders passed items, else flagship defaults. Heading only when title/eyebrow set.

describe('Benefits (render)', () => {
  it('renders passed items (title + sub) over defaults', () => {
    render(
      <Benefits
        title="Why shop"
        eyebrow="Perks"
        items={[
          { icon: 'Truck', title: 'Free delivery', sub: 'On every order' },
          { icon: 'Shield', title: 'Secure pay', sub: 'Encrypted checkout' },
        ]}
      />
    )
    expect(screen.getByRole('heading', { name: 'Why shop' })).toBeInTheDocument()
    expect(screen.getByText('Perks')).toBeInTheDocument()
    expect(screen.getByText('Free delivery')).toBeInTheDocument()
    expect(screen.getByText('On every order')).toBeInTheDocument()
    expect(screen.getByText('Secure pay')).toBeInTheDocument()
  })

  it('falls back to flagship default tiles when items empty', () => {
    render(<Benefits items={[]} />)
    const defaults = (tileDefaultsFor('benefits', true) ?? []) as { title: string }[]
    expect(defaults.length).toBeGreaterThan(0)
    expect(screen.getByText(defaults[0].title)).toBeInTheDocument()
  })

  it('omits the header block when no title and no eyebrow', () => {
    const { container } = render(
      <Benefits items={[{ icon: 'Truck', title: 'Only tile', sub: 'x' }]} />
    )
    expect(container.querySelector('h2')).toBeNull()
    expect(screen.getByText('Only tile')).toBeInTheDocument()
  })
})
