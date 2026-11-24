import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'

import CategoryIcon from '@/components/visitor/CategoryIcon'

const icon = (c: HTMLElement) => c.querySelector('svg')!

describe('CategoryIcon', () => {
  it('uses the named lucide icon when given', () => {
    const { container } = render(<CategoryIcon iconName="Hammer" categoryName="Anything" />)
    expect(icon(container).getAttribute('class')).toContain('lucide-hammer')
  })

  it.each([
    ['Hex Bolts', 'lucide-bolt'],
    ['Welding Rods', 'lucide-flame'],
    ['Safety Gear', 'lucide-shield'],
    ['Power Transmission', 'lucide-cog'],
  ])('picks an icon from the category name "%s"', (name, cls) => {
    const { container } = render(<CategoryIcon categoryName={name} />)
    expect(icon(container).getAttribute('class')).toContain(cls)
  })

  it('matches a keyword inside a longer word', () => {
    const { container } = render(<CategoryIcon categoryName="Hammerheads" />)
    expect(icon(container).getAttribute('class')).toContain('lucide-hammer')
  })

  it('falls back to a package for an unknown name or an unknown icon name', () => {
    const a = render(<CategoryIcon categoryName="Zzz Unknown" />)
    expect(icon(a.container).getAttribute('class')).toContain('lucide-package')
    a.unmount()
    const b = render(<CategoryIcon iconName="NotAnIcon" />)
    expect(icon(b.container).getAttribute('class')).toContain('lucide-package')
  })

  it('applies the class name, defaulting to w-8 h-8', () => {
    const a = render(<CategoryIcon iconName="Hammer" />)
    expect(icon(a.container).getAttribute('class')).toContain('w-8 h-8')
    a.unmount()
    const b = render(<CategoryIcon iconName="Hammer" className="w-4 h-4" />)
    expect(icon(b.container).getAttribute('class')).toContain('w-4 h-4')
  })
})
