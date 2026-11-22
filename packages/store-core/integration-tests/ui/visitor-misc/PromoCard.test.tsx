import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: any) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))

// StoreMedia wraps the backdrop; render children only so the test stays on the promo face.
vi.mock('@/components/visitor/media/StoreMedia', () => ({
  default: ({ children }: any) => <div data-testid="store-media">{children}</div>,
}))

import { PromoCard, PromoBanner, PromoHeading } from '@/components/visitor/slides/PromoCard'

describe('PromoCard', () => {
  it('renders as a link when an href is given and no action', () => {
    render(<PromoCard href="/sale" label="Big Sale" title="Up to 50% off" />)
    const link = screen.getByRole('link', { name: 'Big Sale' })
    expect(link).toHaveAttribute('href', '/sale')
    expect(screen.getByText('Up to 50% off')).toBeInTheDocument()
  })

  it('renders badge, eyebrow, subtitle and CTA when provided', () => {
    render(
      <PromoCard
        href="/sale"
        label="Sale"
        badge="New"
        eyebrow="LIMITED"
        title="Winter Drop"
        sub="Cosy picks"
        ctaLabel="Shop now"
      />
    )
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.getByText('LIMITED')).toBeInTheDocument()
    expect(screen.getByText('Cosy picks')).toBeInTheDocument()
    expect(screen.getByText('Shop now')).toBeInTheDocument()
  })

  it('renders a plain block (no link) when href is null', () => {
    render(<PromoCard href={null} label="Preview" title="Draft slide" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Draft slide')).toBeInTheDocument()
  })

  it('becomes a layered block (link under the action) when an action is present', () => {
    render(<PromoCard href="/p" label="Product" title="Mug" action={<button>Add</button>} />)
    // The CTA button and an overlay link both exist; the whole card is not a single link element.
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Product' })).toHaveAttribute('href', '/p')
  })
})

describe('PromoBanner', () => {
  it('renders the title and CTA for a wide banner', () => {
    render(<PromoBanner href="/deal" label="Deal" title="Mega Deal" ctaLabel="Grab it" />)
    expect(screen.getByRole('link', { name: 'Deal' })).toHaveAttribute('href', '/deal')
    expect(screen.getByText('Mega Deal')).toBeInTheDocument()
    expect(screen.getByText('Grab it')).toBeInTheDocument()
  })
})

describe('PromoHeading', () => {
  it('returns null with neither eyebrow nor title', () => {
    const { container } = render(<PromoHeading />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the eyebrow and title when given', () => {
    render(<PromoHeading eyebrow="FEATURED" title="Top Picks" />)
    expect(screen.getByText('FEATURED')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Top Picks' })).toBeInTheDocument()
  })
})
