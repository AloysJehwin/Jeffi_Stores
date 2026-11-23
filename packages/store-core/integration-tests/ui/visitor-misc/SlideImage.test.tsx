import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/ui/BlurhashCanvas', () => ({
  default: ({ hash }: { hash: string }) => <canvas data-testid="blurhash" data-hash={hash} />,
}))
vi.mock('@/lib/shared/image-url', () => ({
  onImgError: vi.fn<(...a: any[]) => any>(),
  srcSetFor: (src: string | null | undefined, sizes: string) => (src ? `${src} 1x (${sizes})` : undefined),
}))

import SlideImage from '@/components/visitor/slides/SlideImage'

describe('SlideImage (render + source branches)', () => {
  it('renders a <picture> with the mobile img as default and a wide source', () => {
    const { container } = render(<SlideImage src="/wide.jpg" mobileSrc="/mobile.jpg" alt="Hero" />)
    const img = screen.getByAltText('Hero') as HTMLImageElement
    expect(img).toHaveAttribute('src', '/mobile.jpg')
    const source = container.querySelector('source')
    expect(source).toHaveAttribute('data-raw', '/wide.jpg')
  })

  it('renders a single img (no picture) in card mode', () => {
    const { container } = render(<SlideImage cardSrc="/card.jpg" card alt="Card" />)
    expect(container.querySelector('picture')).toBeNull()
    expect(screen.getByAltText('Card')).toHaveAttribute('src', '/card.jpg')
  })

  it('shows the blurhash layer when a hash is available', () => {
    render(<SlideImage src="/wide.jpg" blurhash="LKO2" alt="Hero" />)
    expect(screen.getByTestId('blurhash')).toHaveAttribute('data-hash', 'LKO2')
  })

  it('prefers the card blurhash in card mode', () => {
    render(<SlideImage cardSrc="/card.jpg" card blurhashCard="CARDHASH" blurhash="WIDEHASH" alt="C" />)
    expect(screen.getByTestId('blurhash')).toHaveAttribute('data-hash', 'CARDHASH')
  })

  it('falls back to the placeholder when no source is set', () => {
    render(<SlideImage placeholder="/ph.jpg" alt="PH" />)
    expect(screen.getByAltText('PH')).toHaveAttribute('src', '/ph.jpg')
  })

  it('omits the wide <source> when wide and narrow resolve to the same url', () => {
    const { container } = render(<SlideImage src="/same.jpg" alt="S" />)
    // src only (no mobileSrc) -> wide === narrow, so no extra <source>.
    expect(container.querySelector('source')).toBeNull()
    expect(screen.getByAltText('S')).toHaveAttribute('src', '/same.jpg')
  })

  it('passes the loading attribute through', () => {
    render(<SlideImage src="/a.jpg" alt="A" loading="eager" />)
    expect(screen.getByAltText('A')).toHaveAttribute('loading', 'eager')
  })
})
