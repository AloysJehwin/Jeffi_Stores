import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/components/ui/BlurhashCanvas', () => ({ default: ({ hash }: any) => <div data-testid="blurhash" data-hash={hash} /> }))

import AdminImage from '@/components/admin/AdminImage'

describe('AdminImage', () => {
  it('renders the image with its alt text and a shimmer until it loads', () => {
    const { container } = render(<AdminImage src="/img/a.png" alt="Product photo" className="object-cover" />)
    const img = screen.getByAltText('Product photo')
    expect(img).toHaveAttribute('src', '/img/a.png')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(container.querySelector('[style*="img-shimmer"]')).not.toBeNull()
    fireEvent.load(img)
    expect(container.querySelector('[style*="img-shimmer"]')).toBeNull()
  })

  it('shows a blurhash placeholder instead of the shimmer when given one', () => {
    render(<AdminImage src="/img/a.png" alt="Photo" blurhash="LKO2" />)
    expect(screen.getByTestId('blurhash')).toHaveAttribute('data-hash', 'LKO2')
    fireEvent.load(screen.getByAltText('Photo'))
    expect(screen.queryByTestId('blurhash')).toBeNull()
  })

  it('shows the fallback icon with a screen-reader label when src is missing', () => {
    render(<AdminImage src={null} alt="No photo yet" />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('No photo yet')).toHaveClass('sr-only')
  })

  it('swaps to the fallback when the image fails, using a custom fallback if given', () => {
    render(<AdminImage src="/broken.png" alt="Broken" fallback={<span>custom fallback</span>} />)
    fireEvent.error(screen.getByAltText('Broken'))
    expect(screen.queryByAltText('Broken')).toBeNull()
    expect(screen.getByText('custom fallback')).toBeInTheDocument()
  })

  it('resets when the source changes after a failure', () => {
    const { rerender } = render(<AdminImage src="/broken.png" alt="Pic" />)
    fireEvent.error(screen.getByAltText('Pic'))
    expect(screen.queryByRole('img')).toBeNull()
    rerender(<AdminImage src="/good.png" alt="Pic" />)
    expect(screen.getByAltText('Pic')).toHaveAttribute('src', '/good.png')
  })

  it('applies the wrapper class', () => {
    const { container } = render(<AdminImage src="/a.png" alt="x" wrapperClassName="relative h-10 w-10" />)
    expect(container.firstElementChild).toHaveClass('h-10', 'w-10')
  })
})
