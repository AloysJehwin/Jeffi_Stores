import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// motion/react: SlideArrows and SlideDots don't need it, but Segment (in SlideProgress) does.
// Stub motion.span to a plain span and useTransform to a passthrough value object.
vi.mock('motion/react', () => ({
  motion: new Proxy(
    {},
    { get: () => (props: any) => <span {...props} /> }
  ),
  useTransform: () => ({ get: () => 0 }),
}))

import { SlideArrows, SlideDots, SlideProgress } from '@/components/visitor/slides/SlideControls'

describe('SlideArrows', () => {
  it('renders prev/next buttons with default labels and fires callbacks', () => {
    const onPrev = vi.fn<(...a: any[]) => any>()
    const onNext = vi.fn<(...a: any[]) => any>()
    render(<SlideArrows onPrev={onPrev} onNext={onNext} />)
    fireEvent.click(screen.getByRole('button', { name: 'Previous slide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }))
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('honours custom labels and disabled flags', () => {
    render(
      <SlideArrows
        onPrev={() => {}}
        onNext={() => {}}
        prevLabel="Scroll left"
        nextLabel="Scroll right"
        prevDisabled
      />
    )
    expect(screen.getByRole('button', { name: 'Scroll left' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Scroll right' })).not.toBeDisabled()
  })
})

describe('SlideDots', () => {
  it('renders one dot per slide and marks the current one', () => {
    render(<SlideDots count={3} index={1} onSelect={() => {}} />)
    const dots = screen.getAllByRole('button')
    expect(dots).toHaveLength(3)
    expect(dots[1]).toHaveAttribute('aria-current', 'true')
    expect(dots[0]).not.toHaveAttribute('aria-current')
  })

  it('calls onSelect with the dot index on click', () => {
    const onSelect = vi.fn<(...a: any[]) => any>()
    render(<SlideDots count={3} index={0} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Go to slide 3' }))
    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('uses a custom label builder', () => {
    render(<SlideDots count={2} index={0} onSelect={() => {}} label={i => `Offer ${i + 1}`} />)
    expect(screen.getByRole('button', { name: 'Offer 2' })).toBeInTheDocument()
  })
})

describe('SlideProgress', () => {
  const progress = { get: () => 0 } as any

  it('renders decorative (aria-hidden) segments without onSelect', () => {
    const { container } = render(<SlideProgress count={3} index={0} progress={progress} />)
    // No onSelect -> the wrapper is aria-hidden and segments are not buttons.
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('renders selectable segment buttons when onSelect is given', () => {
    const onSelect = vi.fn<(...a: any[]) => any>()
    render(<SlideProgress count={3} index={1} progress={progress} onSelect={onSelect} label={i => `Go ${i + 1}`} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Go 3' }))
    expect(onSelect).toHaveBeenCalledWith(2)
    expect(buttons[1]).toHaveAttribute('aria-current', 'true')
  })
})
