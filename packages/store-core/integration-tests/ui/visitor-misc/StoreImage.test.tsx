import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/components/ui/BlurhashCanvas', () => ({
  default: ({ hash }: { hash: string }) => <canvas data-testid="blurhash" data-hash={hash} />,
}))
vi.mock('@/lib/shared/image-url', () => ({
  srcSetFor: (src: string, sizes: string) => `${src} 1x, ${src}?w=2x 2x (${sizes})`,
  fallBackToOriginal: vi.fn<(...a: any[]) => any>(() => false),
}))

import StoreImage from '@/components/visitor/StoreImage'

describe('StoreImage (render + states)', () => {
  it('renders the img with alt and lazy loading by default', () => {
    render(<StoreImage src="/cdn/a.jpg" alt="A product" />)
    const img = screen.getByAltText('A product') as HTMLImageElement
    expect(img).toHaveAttribute('src', '/cdn/a.jpg')
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('shows the shimmer placeholder (no blurhash) before load', () => {
    const { container } = render(<StoreImage src="/cdn/a.jpg" alt="A" />)
    // img starts opacity-0; a shimmer div is present, no blurhash canvas.
    expect(screen.queryByTestId('blurhash')).not.toBeInTheDocument()
    const img = container.querySelector('img')!
    expect(img.className).toContain('opacity-0')
  })

  it('renders the blurhash placeholder when a hash is given', () => {
    render(<StoreImage src="/cdn/a.jpg" alt="A" blurhash="LKO2:N%2" />)
    expect(screen.getByTestId('blurhash')).toHaveAttribute('data-hash', 'LKO2:N%2')
  })

  it('marks a priority image eager with high fetch priority', () => {
    render(<StoreImage src="/cdn/hero.jpg" alt="Hero" priority />)
    const img = screen.getByAltText('Hero')
    expect(img).toHaveAttribute('loading', 'eager')
    expect(img).toHaveAttribute('fetchpriority', 'high')
  })

  it('builds a srcset only when sizes is passed', () => {
    const { rerender } = render(<StoreImage src="/cdn/a.jpg" alt="A" />)
    expect(screen.getByAltText('A')).not.toHaveAttribute('srcset')
    rerender(<StoreImage src="/cdn/a.jpg" alt="A" sizes="200px" />)
    expect(screen.getByAltText('A')).toHaveAttribute('srcset', expect.stringContaining('/cdn/a.jpg'))
  })

  it('fades the image in once it loads', () => {
    const { container } = render(<StoreImage src="/cdn/a.jpg" alt="A" />)
    const img = container.querySelector('img')!
    expect(img.className).toContain('opacity-0')
    fireEvent.load(img)
    expect(img.className).toContain('opacity-100')
  })

  it('fires onClick on the wrapper', () => {
    const onClick = vi.fn<(...a: any[]) => any>()
    render(<StoreImage src="/cdn/a.jpg" alt="A" onClick={onClick} wrapperClassName="wrap" />)
    fireEvent.click(screen.getByAltText('A').parentElement!)
    expect(onClick).toHaveBeenCalled()
  })
})
