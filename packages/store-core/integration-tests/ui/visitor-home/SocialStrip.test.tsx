import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock the media child (hits StoreMedia -> image pipeline) and next/link so we test SocialStrip's own
// output: links, captions, external rel, and the optional CTA.
vi.mock('@/components/visitor/media/StoreMedia', () => ({
  default: ({ alt }: { alt?: string }) => <img alt={alt} data-testid="store-media" />,
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

import SocialStrip from '@/components/visitor/home/SocialStrip'

const items = [
  { imageUrl: '/a.jpg', url: 'https://instagram.com/p/1', caption: 'Shot one' },
  { imageUrl: '/b.jpg', url: '/posts/2', caption: 'Shot two' },
]

describe('SocialStrip (render)', () => {
  it('renders one media link per item with its caption', () => {
    render(<SocialStrip items={items} />)
    expect(screen.getAllByTestId('store-media')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Shot one' })).toHaveAttribute('href', 'https://instagram.com/p/1')
    expect(screen.getByRole('link', { name: 'Shot two' })).toHaveAttribute('href', '/posts/2')
  })

  it('marks external post links with target _blank + noopener', () => {
    render(<SocialStrip items={items} />)
    const ext = screen.getByRole('link', { name: 'Shot one' })
    expect(ext).toHaveAttribute('target', '_blank')
    expect(ext).toHaveAttribute('rel', 'noopener noreferrer')
    // Internal link gets no new-tab props.
    expect(screen.getByRole('link', { name: 'Shot two' })).not.toHaveAttribute('target')
  })

  it('renders the CTA only when ctaUrl is set', () => {
    const { rerender } = render(<SocialStrip items={items} />)
    expect(screen.queryByRole('link', { name: 'Follow us' })).toBeNull()
    rerender(<SocialStrip items={items} ctaUrl="/social" ctaLabel="Follow us" />)
    expect(screen.getByRole('link', { name: 'Follow us' })).toHaveAttribute('href', '/social')
  })
})
