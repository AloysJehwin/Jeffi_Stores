import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const reduced = vi.hoisted(() => ({ value: false }))
vi.mock('motion/react', () => ({
  useReducedMotion: () => reduced.value,
  motion: {
    div: ({ children, initial }: any) => (
      <div data-testid="reveal" data-initial={JSON.stringify(initial)}>
        {children}
      </div>
    ),
  },
}))

import Reveal from '@/components/visitor/home/Reveal'

describe('home Reveal', () => {
  it('renders its children and starts hidden below the fold', () => {
    reduced.value = false
    render(<Reveal><p>Below the fold</p></Reveal>)
    expect(screen.getByText('Below the fold')).toBeInTheDocument()
    expect(JSON.parse(screen.getByTestId('reveal').dataset.initial!)).toEqual({ opacity: 0, y: 24 })
  })

  it('renders at rest when disabled (above the fold)', () => {
    reduced.value = false
    render(<Reveal disabled><p>Hero</p></Reveal>)
    expect(screen.getByTestId('reveal').dataset.initial).toBe('false')
  })

  it('renders at rest for visitors who prefer reduced motion', () => {
    reduced.value = true
    render(<Reveal><p>Calm</p></Reveal>)
    expect(screen.getByTestId('reveal').dataset.initial).toBe('false')
  })
})
