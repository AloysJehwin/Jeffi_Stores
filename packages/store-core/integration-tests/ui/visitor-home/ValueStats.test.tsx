import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ValueStats from '@/components/visitor/home/ValueStats'
import { friendlyCount, SECTION_COPY_DEFAULTS } from '@/lib/catalog/homepage-sections'

// ValueStats: animated count-up figures. Without IntersectionObserver (happy-dom) the effect bails and
// progress stays 1, so friendlyCount() final figures render. Server-safe output is what we assert.

describe('ValueStats (render)', () => {
  it('renders each stat label and its friendlyCount figure', () => {
    render(
      <ValueStats
        stats={[
          { metric: 'orders_shipped', label: 'Orders shipped', value: 4821 },
          { metric: 'customers', label: 'Happy customers', value: 173 },
        ]}
      />
    )
    expect(screen.getByText('Orders shipped')).toBeInTheDocument()
    expect(screen.getByText(friendlyCount(4821))).toBeInTheDocument() // "4,800+"
    expect(screen.getByText('Happy customers')).toBeInTheDocument()
    expect(screen.getByText(friendlyCount(173))).toBeInTheDocument() // "170+"
  })

  it('uses default eyebrow/title when not supplied', () => {
    render(<ValueStats stats={[{ metric: 'orders_shipped', label: 'Orders', value: 10 }]} />)
    expect(screen.getByRole('heading', { name: SECTION_COPY_DEFAULTS.value_stats.title! })).toBeInTheDocument()
  })

  it('renders a custom eyebrow/title over defaults', () => {
    render(
      <ValueStats
        stats={[{ metric: 'orders_shipped', label: 'Orders', value: 10 }]}
        eyebrow="By the numbers"
        title="Our scale"
      />
    )
    expect(screen.getByText('By the numbers')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Our scale' })).toBeInTheDocument()
  })
})
