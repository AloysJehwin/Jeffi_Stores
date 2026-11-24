import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('@/components/visitor/media/StoreMedia', () => ({
  default: ({ children }: any) => <div data-testid="media">{children}</div>,
}))

import AboutSection from '@/components/visitor/home/AboutSection'

const stats = [{ value: '10k+', label: 'Customers' }, { value: '25', label: 'Years' }]

describe('AboutSection', () => {
  it('renders copy, stats over the image, and the default buttons', () => {
    render(<AboutSection aboutCopy="We sell tools." stats={stats} storeName="Jeffi" imageUrl="/team.jpg" title="Our story" eyebrow="About us" body="Family run." />)
    expect(screen.getByRole('heading', { name: 'Our story' })).toBeInTheDocument()
    expect(screen.getByText('About us')).toBeInTheDocument()
    expect(screen.getByText('We sell tools.')).toBeInTheDocument()
    expect(screen.getByText('Family run.')).toBeInTheDocument()
    expect(screen.getByAltText('Jeffi team')).toBeInTheDocument()
    expect(screen.getByText('10k+')).toBeInTheDocument()
    expect(screen.getByText('Customers')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse Products' })).toHaveAttribute('href', '/products')
  })

  it('uses a custom CTA label and url', () => {
    render(<AboutSection aboutCopy="x" stats={[]} storeName="S" imageUrl="/a.jpg" ctaLabel="Meet us" ctaUrl="/team" />)
    expect(screen.getByRole('link', { name: /Meet us/ })).toHaveAttribute('href', '/team')
  })

  it('omits the picture and stats for a non-flagship store without an image', () => {
    render(<AboutSection aboutCopy="Neutral copy." stats={stats} storeName="Acme" flagshipCopy={false} />)
    expect(screen.queryByAltText('Acme team')).toBeNull()
    expect(screen.queryByText('10k+')).toBeNull()
    expect(screen.getByText('Neutral copy.')).toBeInTheDocument()
  })
})
