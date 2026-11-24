import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('@/components/visitor/media/StoreMedia', () => ({
  default: ({ image, video }: any) => <div data-testid="media" data-image={image} data-video={video} />,
}))

import BlogTeaser from '@/components/visitor/home/BlogTeaser'

const items = [
  { title: 'Pick a drill', excerpt: 'Which one fits you.', url: '/blog/drill', imageUrl: '/d.jpg' },
  { title: 'External read', excerpt: '', url: 'https://example.com/post', imageUrl: '' },
]

describe('BlogTeaser', () => {
  it('lists articles with excerpt, read-more and media or a fallback icon', () => {
    render(<BlogTeaser items={items} />)
    expect(screen.getByRole('heading', { name: 'Tips and how-tos' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Pick a drill' })).toBeInTheDocument()
    expect(screen.getByText('Which one fits you.')).toBeInTheDocument()
    expect(screen.getAllByText('Read more')).toHaveLength(2)
    expect(screen.getAllByTestId('media')).toHaveLength(1)
  })

  it('opens external articles in a new tab only', () => {
    render(<BlogTeaser items={items} />)
    const internal = screen.getByRole('link', { name: /Pick a drill/ })
    const external = screen.getByRole('link', { name: /External read/ })
    expect(internal).not.toHaveAttribute('target')
    expect(external).toHaveAttribute('target', '_blank')
    expect(external).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows the CTA (desktop and mobile) when label and url are set', () => {
    render(<BlogTeaser items={items} ctaLabel="All guides" ctaUrl="/blog" eyebrow="Learn" title="From the blog" />)
    expect(screen.getAllByRole('link', { name: 'All guides' })).toHaveLength(2)
    expect(screen.getByText('Learn')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'From the blog' })).toBeInTheDocument()
  })

  it('omits the CTA without a url and renders no cards for no items', () => {
    render(<BlogTeaser items={[]} ctaLabel="All guides" />)
    expect(screen.queryByRole('link')).toBeNull()
  })
})
