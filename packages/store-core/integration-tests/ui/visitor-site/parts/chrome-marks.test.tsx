import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StoreLogoMark, CART_GLYPH } from '@/components/visitor/site/code/parts/chrome/marks'

describe('StoreLogoMark', () => {
  it('shows the logo image with the store name and tagline', () => {
    render(<StoreLogoMark name="Jeffi" logoUrl="/logo.png" tagline="Tools for builders" />)
    expect(screen.getByAltText('Jeffi Logo')).toHaveAttribute('src', '/logo.png')
    expect(screen.getByText('Jeffi')).toBeInTheDocument()
    expect(screen.getByText('Tools for builders')).toBeInTheDocument()
  })

  it('falls back to the name\'s initial in a badge when there is no logo', () => {
    render(<StoreLogoMark name="  acme" logoUrl={null} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('A')).toHaveAttribute('aria-hidden', 'true')
  })

  it('uses S when the name is blank', () => {
    render(<StoreLogoMark name="   " logoUrl={null} />)
    expect(screen.getByText('S')).toBeInTheDocument()
  })

  it('can hide the name and tagline', () => {
    render(<StoreLogoMark name="Jeffi" logoUrl="/l.png" tagline="Tag" showName={false} />)
    expect(screen.queryByText('Jeffi')).toBeNull()
    expect(screen.queryByText('Tag')).toBeNull()
  })

  it('exports the cart icon path', () => {
    expect(CART_GLYPH.startsWith('M3 3h2')).toBe(true)
  })
})
