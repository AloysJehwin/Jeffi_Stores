import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import CheckMark from '@/components/ui/CheckMark'

describe('CheckMark (render)', () => {
  it('renders an svg with the tick path', () => {
    const { container } = render(<CheckMark />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.querySelector('path')).toHaveAttribute('d', 'M4.5 12.75l6 6 9-13.5')
  })

  it('applies a passed className', () => {
    const { container } = render(<CheckMark className="w-5 h-5 text-green-500" />)
    expect(container.querySelector('svg')).toHaveClass('w-5', 'h-5', 'text-green-500')
  })
})
