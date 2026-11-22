import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'

// image-url helpers are pure (no server), but mock to keep srcset deterministic.
vi.mock('@/lib/shared/image-url', () => ({
  srcSetFor: () => '/_next/image?url=x&w=640 640w',
  fallBackToOriginal: () => false,
}))

describe('ImgWithSkeleton (render + load states)', () => {
  it('renders the img with src and alt', () => {
    render(<ImgWithSkeleton src="/p.jpg" alt="Product photo" />)
    const img = screen.getByAltText('Product photo')
    expect(img).toHaveAttribute('src', '/p.jpg')
  })

  it('starts hidden (opacity-0) then becomes visible on load', () => {
    render(<ImgWithSkeleton src="/p.jpg" alt="Product photo" />)
    const img = screen.getByAltText('Product photo')
    expect(img.className).toContain('opacity-0')
    fireEvent.load(img)
    expect(img.className).toContain('opacity-100')
  })

  it('renders the shimmer skeleton when no blurhash is given', () => {
    const { container } = render(<ImgWithSkeleton src="/p.jpg" alt="x" />)
    // shimmer wrapper uses bg-gray-200 before load
    expect(container.querySelector('.bg-gray-200')).toBeTruthy()
  })

  it('attaches a srcset when sizes is provided', () => {
    render(<ImgWithSkeleton src="/p.jpg" alt="x" sizes="80px" />)
    expect(screen.getByAltText('x')).toHaveAttribute('srcset', '/_next/image?url=x&w=640 640w')
  })

  it('passes the loading attribute through', () => {
    render(<ImgWithSkeleton src="/p.jpg" alt="x" loading="lazy" />)
    expect(screen.getByAltText('x')).toHaveAttribute('loading', 'lazy')
  })
})
