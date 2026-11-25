import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

import Slides, { useSlide } from '@/components/visitor/slides/Slides'

const scrollTo = vi.fn()
beforeEach(() => {
  scrollTo.mockReset()
  Element.prototype.scrollTo = scrollTo as any
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  )
})
afterEach(() => vi.unstubAllGlobals())

function Tag({ text }: { text: string }) {
  const s = useSlide()
  return <span data-testid={`tag-${text}`}>{`${text}:${s.current ? 'current' : 'idle'}:${s.clone ? 'clone' : 'real'}`}</span>
}
const kids = (n: number) => Array.from({ length: n }, (_, i) => <Tag key={`k${i}`} text={`s${i}`} />)

describe('Slides: empty and single', () => {
  it('renders nothing without slides (except an empty rail, which keeps its frame)', () => {
    const a = render(<Slides layout="fade" ariaLabel="x">{[]}</Slides>)
    expect(a.container).toBeEmptyDOMElement()
    a.unmount()
    const b = render(<Slides layout="cards" ariaLabel="x">{[]}</Slides>)
    expect(b.container).toBeEmptyDOMElement()
    b.unmount()
    render(<Slides layout="rail" ariaLabel="rail">{[]}</Slides>)
    expect(screen.getByRole('region', { name: 'rail' })).toBeInTheDocument()
  })

  it('a lone banner is just the slide in its wrapper, no carousel chrome', () => {
    const { container } = render(<Slides layout="banner" ariaLabel="b" className="wrap">{kids(1)}</Slides>)
    expect(container.firstChild).toHaveClass('wrap')
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(screen.getByTestId('tag-s0')).toHaveTextContent('s0:current:real')
  })
})

describe('Slides: fade', () => {
  it('is a labelled carousel region of numbered slides with only the active one exposed', () => {
    render(<Slides layout="fade" ariaLabel="Featured">{kids(3)}</Slides>)
    expect(screen.getByRole('region', { name: 'Featured' })).toHaveAttribute('aria-roledescription', 'carousel')
    const groups = screen.getAllByRole('group', { hidden: true })
    expect(groups.map(g => g.getAttribute('aria-label'))).toEqual(['1 of 3', '2 of 3', '3 of 3'])
    expect(groups.map(g => g.getAttribute('aria-hidden'))).toEqual(['false', 'true', 'true'])
    expect(screen.getByTestId('tag-s0')).toHaveTextContent('current')
    expect(screen.getByTestId('tag-s1')).toHaveTextContent('idle')
  })

  it('shows dots by default that jump to a slide, and calls onIndexChange', () => {
    const onIndexChange = vi.fn()
    render(<Slides layout="fade" ariaLabel="F" onIndexChange={onIndexChange}>{kids(3)}</Slides>)
    fireEvent.click(screen.getByRole('button', { name: 'Go to slide 3' }))
    expect(onIndexChange).toHaveBeenCalledWith(2)
    expect(screen.getByTestId('tag-s2')).toHaveTextContent('current')
  })

  it('arrows step and wrap around, with item-specific labels', () => {
    render(<Slides layout="fade" ariaLabel="F" arrows itemLabel="offer">{kids(3)}</Slides>)
    fireEvent.click(screen.getByRole('button', { name: 'Previous offer' }))
    expect(screen.getByTestId('tag-s2')).toHaveTextContent('current')
    fireEvent.click(screen.getByRole('button', { name: 'Next offer' }))
    expect(screen.getByTestId('tag-s0')).toHaveTextContent('current')
  })

  it('arrow keys on the region step through the slides; modified keys and text fields are ignored', () => {
    render(<Slides layout="fade" ariaLabel="F">{[...kids(2), <input key="i" aria-label="field" />]}</Slides>)
    const region = screen.getByRole('region', { name: 'F' })
    fireEvent.keyDown(region, { key: 'ArrowRight' })
    expect(screen.getByTestId('tag-s1')).toHaveTextContent('current')
    fireEvent.keyDown(region, { key: 'ArrowRight', shiftKey: true })
    expect(screen.getByTestId('tag-s1')).toHaveTextContent('current')
    fireEvent.keyDown(region, { key: 'ArrowLeft' })
    expect(screen.getByTestId('tag-s0')).toHaveTextContent('current')
    fireEvent.keyDown(screen.getByLabelText('field', { selector: 'input' }), { key: 'ArrowRight' })
    expect(screen.getByTestId('tag-s0')).toHaveTextContent('current')
  })

  it('a controlled index wins over internal state', () => {
    const onIndexChange = vi.fn()
    const { rerender } = render(<Slides layout="fade" ariaLabel="F" index={1} onIndexChange={onIndexChange}>{kids(3)}</Slides>)
    expect(screen.getByTestId('tag-s1')).toHaveTextContent('current')
    fireEvent.click(screen.getByRole('button', { name: 'Go to slide 3' }))
    expect(onIndexChange).toHaveBeenCalledWith(2)
    expect(screen.getByTestId('tag-s1')).toHaveTextContent('current')
    rerender(<Slides layout="fade" ariaLabel="F" index={2} onIndexChange={onIndexChange}>{kids(3)}</Slides>)
    expect(screen.getByTestId('tag-s2')).toHaveTextContent('current')
  })

  it('a single fade slide has no dots, arrows or tab stop', () => {
    render(<Slides layout="fade" ariaLabel="F" arrows>{kids(1)}</Slides>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'F' })).not.toHaveAttribute('tabindex')
  })

  it('progress segments replace nothing: they are offered when asked', () => {
    render(<Slides layout="fade" ariaLabel="F" progress dots={false} autoplay={false}>{kids(2)}</Slides>)
    expect(screen.getByRole('button', { name: 'Go to slide 1' })).toBeInTheDocument()
  })

  it('autoplay advances to the next slide when the clock completes', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] })
    try {
      render(<Slides layout="fade" ariaLabel="F" autoplay={1000}>{kids(2)}</Slides>)
      act(() => {
        vi.advanceTimersByTime(1200)
      })
      expect(screen.getByTestId('tag-s1')).toHaveTextContent('current')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Slides: banner and rail tracks', () => {
  it('banner with several slides: numbered groups, arrows and dots by default', () => {
    render(<Slides layout="banner" ariaLabel="Offers" itemLabel="offer">{kids(3)}</Slides>)
    expect(screen.getByRole('region', { name: 'Offers' })).toBeInTheDocument()
    expect(screen.getAllByRole('group', { hidden: true }).map(g => g.getAttribute('aria-label'))).toEqual(['1 of 3', '2 of 3', '3 of 3'])
    expect(screen.getByRole('button', { name: 'Next offer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to slide 2' })).toBeInTheDocument()
  })

  it('banner: the dots and arrows scroll the track to the chosen slide', () => {
    render(<Slides layout="banner" ariaLabel="B">{kids(3)}</Slides>)
    fireEvent.click(screen.getByRole('button', { name: 'Go to slide 3' }))
    expect(scrollTo).toHaveBeenCalled()
    scrollTo.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }))
    expect(scrollTo).toHaveBeenCalled()
  })

  it('banner: arrow keys on the track page too', () => {
    render(<Slides layout="banner" ariaLabel="B">{kids(3)}</Slides>)
    const track = screen.getByRole('region', { name: 'B' }).querySelector('[tabindex="0"]')!
    fireEvent.keyDown(track, { key: 'ArrowRight' })
    expect(scrollTo).toHaveBeenCalled()
  })

  it('rail: slides are plain items with no dots, and no arrows until the row overflows', () => {
    const { container } = render(<Slides layout="rail" ariaLabel="Products">{kids(4)}</Slides>)
    expect(container.querySelectorAll('[data-slide]')).toHaveLength(4)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { hidden: true })).not.toBeInTheDocument()
    expect(screen.getByTestId('tag-s0')).toHaveTextContent('s0:current:real')
  })

  it('rail: item width classes are applied', () => {
    const { container } = render(<Slides layout="rail" ariaLabel="P" itemClassName="w-1/2">{kids(2)}</Slides>)
    expect(container.querySelector('[data-slide]')!.className).toContain('w-1/2')
  })
})

describe('Slides: cards', () => {
  it('draws numbered card slides with the first current and no clones for a short list', () => {
    const { container } = render(<Slides layout="cards" ariaLabel="Cards" aspect="1:1">{kids(3)}</Slides>)
    expect(screen.getByRole('region', { name: 'Cards' })).toBeInTheDocument()
    expect(screen.getAllByRole('group', { hidden: true }).map(g => g.getAttribute('aria-label'))).toEqual(['1 of 3', '2 of 3', '3 of 3'])
    expect(screen.getByTestId('tag-s0')).toHaveTextContent('s0:current:real')
    expect(container.innerHTML).toContain('aspect-square')
  })

  it('from four slides it loops through decorative clones that are never current', () => {
    render(<Slides layout="cards" ariaLabel="Cards">{kids(4)}</Slides>)
    const clones = screen.getAllByTestId(/^tag-s\d$/).filter(el => el.textContent!.includes(':clone'))
    expect(clones.length).toBe(8)
    expect(clones.every(c => c.textContent!.includes(':idle'))).toBe(true)
  })

  it('loop={false} keeps a long list unrepeated', () => {
    render(<Slides layout="cards" ariaLabel="Cards" loop={false}>{kids(5)}</Slides>)
    expect(screen.getAllByTestId(/^tag-s\d$/)).toHaveLength(5)
  })

  it('its arrows and dots page the cards', () => {
    render(<Slides layout="cards" ariaLabel="Cards">{kids(3)}</Slides>)
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }))
    expect(scrollTo).toHaveBeenCalled()
    scrollTo.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Go to slide 2' }))
    expect(scrollTo).toHaveBeenCalled()
  })

  it('arrows and dots can be switched off', () => {
    render(<Slides layout="cards" ariaLabel="Cards" arrows={false} dots={false}>{kids(3)}</Slides>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
