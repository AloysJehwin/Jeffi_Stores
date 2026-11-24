import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const reduced = vi.hoisted(() => ({ value: false }))
vi.mock('motion/react', () => ({
  useReducedMotion: () => reduced.value,
  motion: {
    div: ({ children, initial, transition, className }: any) => (
      <div data-testid="reveal" className={className} data-initial={JSON.stringify(initial)} data-delay={transition.delay}>
        {children}
      </div>
    ),
  },
}))

import Reveal from '@/components/visitor/site/code/islands/Reveal'

const initial = () => JSON.parse(screen.getByTestId('reveal').dataset.initial!)

describe('site Reveal island', () => {
  it('eases content in from below by default', () => {
    reduced.value = false
    render(<Reveal className="box"><p>Hello</p></Reveal>)
    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.getByTestId('reveal')).toHaveClass('box')
    expect(initial()).toEqual({ opacity: 0, y: 28 })
  })

  it.each([
    ['fade', { opacity: 0 }],
    ['zoom', { opacity: 0, scale: 0.94 }],
    ['slide-left', { opacity: 0, x: 40 }],
    ['slide-right', { opacity: 0, x: -40 }],
    ['unknown', { opacity: 0, y: 28 }],
  ])('uses the %s starting pose', (effect, expected) => {
    reduced.value = false
    render(<Reveal effect={effect}>x</Reveal>)
    expect(initial()).toEqual(expected)
  })

  it('clamps the delay to between 0 and 2 seconds', () => {
    reduced.value = false
    const { rerender } = render(<Reveal delay={5}>x</Reveal>)
    expect(screen.getByTestId('reveal').dataset.delay).toBe('2')
    rerender(<Reveal delay={-1}>x</Reveal>)
    expect(screen.getByTestId('reveal').dataset.delay).toBe('0')
  })

  it('shows content at rest under reduced motion', () => {
    reduced.value = true
    render(<Reveal>x</Reveal>)
    expect(screen.getByTestId('reveal').dataset.initial).toBe('false')
  })
})
