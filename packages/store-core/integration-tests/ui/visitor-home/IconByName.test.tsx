import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import IconByName from '@/components/visitor/home/IconByName'

describe('IconByName', () => {
  it('renders the named lucide icon with the given class', () => {
    const { container } = render(<IconByName name="Truck" className="w-4 h-4" />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveClass('lucide-truck')
    expect(svg).toHaveClass('w-4')
  })

  it('falls back to the Package icon for an unknown name', () => {
    const { container } = render(<IconByName name="NotARealIcon" />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveClass('lucide-package')
    expect(svg).toHaveClass('w-6')
  })

  it('falls back to the Package icon when no name is given', () => {
    const { container } = render(<IconByName name={null} />)
    expect(container.querySelector('svg')).toHaveClass('lucide-package')
  })
})
