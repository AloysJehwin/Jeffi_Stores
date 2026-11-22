import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { SocialIcon } from '@/components/auth/SocialIcons'
import { SOCIAL_PROVIDERS } from '@/lib/auth/social/types'

// Pure presentational brand marks. Each provider yields an <svg>; Google is multicolour, the rest
// inherit currentColor.

describe('SocialIcon (render)', () => {
  it('renders an svg for every known provider', () => {
    for (const p of SOCIAL_PROVIDERS) {
      const { container, unmount } = render(<SocialIcon provider={p} />)
      const svg = container.querySelector('svg')
      expect(svg, p).not.toBeNull()
      unmount()
    }
  })

  it('applies the default icon size class', () => {
    const { container } = render(<SocialIcon provider="github" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('class')).toContain('w-5')
    expect(svg.getAttribute('class')).toContain('h-5')
  })

  it('honours a custom className override', () => {
    const { container } = render(<SocialIcon provider="apple" className="w-8 h-8 custom" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('class')).toBe('w-8 h-8 custom')
  })

  it('gives Google its multicolour fills (not currentColor)', () => {
    const { container } = render(<SocialIcon provider="google" />)
    const paths = Array.from(container.querySelectorAll('path'))
    expect(paths.some(p => p.getAttribute('fill') === '#4285F4')).toBe(true)
  })

  it('renders Apple/GitHub with currentColor fill on the svg', () => {
    const { container } = render(<SocialIcon provider="apple" />)
    expect(container.querySelector('svg')!.getAttribute('fill')).toBe('currentColor')
  })

  it('falls back to the github mark for an unknown provider', () => {
    // The component treats anything not google/facebook/apple as the github branch.
    // @ts-expect-error exercising the default branch
    const { container } = render(<SocialIcon provider="unknown" />)
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
