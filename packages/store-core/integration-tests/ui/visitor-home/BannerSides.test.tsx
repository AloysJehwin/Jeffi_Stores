import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BannerSides from '@/components/visitor/home/BannerSides'

const peek = (onSelect = vi.fn()) => ({
  prev: { image: 'https://cdn.test/p.jpg', label: 'Previous slide', onSelect },
  next: { image: null, label: 'Next slide', onSelect },
})

describe('BannerSides', () => {
  it('passes the banner through untouched for plain sides', () => {
    const { container } = render(<BannerSides sides="plain"><p>Banner</p></BannerSides>)
    expect(screen.getByText('Banner')).toBeInTheDocument()
    expect(container.querySelector('.relative')).toBeNull()
  })

  it('adds a shadow layer', () => {
    const { container } = render(<BannerSides sides="shadow"><p>Banner</p></BannerSides>)
    expect(screen.getByText('Banner')).toBeInTheDocument()
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument()
  })

  it('draws a glow from the image, and nothing without one', () => {
    const { container, rerender } = render(<BannerSides sides="glow" image="https://cdn.test/hero.jpg"><p>Banner</p></BannerSides>)
    expect(container.innerHTML).toContain('hero.jpg')
    rerender(<BannerSides sides="glow"><p>Banner</p></BannerSides>)
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
  })

  it('shows previous and next cards that select their slide', () => {
    const onSelect = vi.fn()
    render(<BannerSides sides="peek" aspect={0.5} {...peek(onSelect)}><p>Banner</p></BannerSides>)
    fireEvent.click(screen.getByRole('button', { name: 'Previous slide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }))
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('falls back to the plain banner when peek lacks an aspect or neighbours', () => {
    render(<BannerSides sides="peek"><p>Banner</p></BannerSides>)
    expect(screen.getByText('Banner')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
