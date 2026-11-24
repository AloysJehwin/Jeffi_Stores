import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const autoplay = vi.hoisted(() => ({ current: null as any }))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('@/components/visitor/StoreImage', () => ({ default: ({ src, alt }: any) => <img src={src} alt={alt} /> }))
vi.mock('@/components/visitor/media/StoreMedia', () => ({
  default: ({ image, active }: any) => <div data-testid="bg" data-image={image} data-active={String(active)} />,
  useCanPlayVideo: () => false,
}))
vi.mock('@/components/visitor/slides/SlideControls', () => ({
  SlideArrows: ({ onPrev, onNext }: any) => (
    <div>
      <button onClick={onPrev}>Prev</button>
      <button onClick={onNext}>Next</button>
    </div>
  ),
  SlideProgress: ({ count, label, onSelect }: any) => (
    <div>
      {Array.from({ length: count }, (_, i) => (
        <button key={i} onClick={() => onSelect(i)}>{label(i)}</button>
      ))}
    </div>
  ),
}))
vi.mock('@/components/visitor/slides/PromoCard', () => ({ bannerShape: (a: number) => ({ aspectRatio: a }) }))
vi.mock('@/components/visitor/slides/useAutoplay', () => ({
  useAutoplay: (o: any) => {
    autoplay.current = o
    return { progress: { on: () => () => {}, get: () => 0 }, reduced: false, bind: { onPointerLeave: () => {} } }
  },
}))
vi.mock('@/components/visitor/slides/useSwipe', () => ({
  useSwipe: () => ({ pressed: false, bind: { onPointerMove: () => {} } }),
}))
vi.mock('@/components/visitor/slides/slide-motion', () => ({
  FADE_S: 0.5,
  KEN_BURNS: 0.1,
  RevealWords: ({ text }: any) => <>{text}</>,
  headlineVariants: () => ({}),
  riseVariants: () => ({}),
  usePointerParallax: () => ({ x: 0, y: 0, onPointerMove: () => {}, onPointerLeave: () => {} }),
}))
vi.mock('motion/react', async () => {
  const React = await import('react')
  const strip = (tag: string) => function Stripped({ children, className, role, ...rest }: any) {
    return React.createElement(tag, { className, role, 'aria-label': rest['aria-label'], 'aria-hidden': rest['aria-hidden'], 'aria-roledescription': rest['aria-roledescription'] }, children)
  }
  return {
    motion: { div: strip('div'), p: strip('p'), h1: strip('h1') },
    useMotionValue: (v: number) => ({ set: () => {}, get: () => v }),
    useMotionValueEvent: () => {},
  }
})

import MotionHero from '@/components/visitor/home/MotionHero'

const slides = [
  { headline: 'Summer sale', eyebrow: 'New', sub: 'Up to 40% off', bgImage: '/a.jpg', fgImage: '/fg.png', fgFrame: 'rounded', url: '/sale', ctaLabel: 'Shop sale' },
  { headline: 'Power tools', bgImage: '/b.jpg', fgImage: null, fgFrame: 'none', url: '/tools' },
] as any

const active = () => screen.getAllByRole('group', { hidden: true }).filter(g => g.getAttribute('aria-hidden') === 'false')

describe('MotionHero', () => {
  it('renders nothing without slides', () => {
    const { container } = render(<MotionHero slides={[]} intervalMs={5000} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows every slide labelled "n of m", the first one visible, with copy, picture and CTA', () => {
    render(<MotionHero slides={slides} intervalMs={5000} />)
    expect(screen.getByRole('region', { name: 'Featured' })).toBeInTheDocument()
    expect(screen.getAllByRole('group', { hidden: true })).toHaveLength(2)
    expect(active()[0]).toHaveAttribute('aria-label', '1 of 2')
    expect(screen.getByRole('heading', { name: 'Summer sale', hidden: true })).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.getByText('Up to 40% off')).toBeInTheDocument()
    expect(screen.getByAltText('Summer sale')).toHaveAttribute('src', '/fg.png')
    expect(screen.getByRole('link', { name: /Shop sale/, hidden: true })).toHaveAttribute('href', '/sale')
    // Default CTA label when a slide has none.
    expect(screen.getByRole('link', { name: /Shop now/, hidden: true })).toHaveAttribute('href', '/tools')
  })

  it('goes to the next and previous slide, wrapping around', () => {
    render(<MotionHero slides={slides} intervalMs={5000} />)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(active()[0]).toHaveAttribute('aria-label', '2 of 2')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(active()[0]).toHaveAttribute('aria-label', '1 of 2')
    fireEvent.click(screen.getByRole('button', { name: 'Prev' }))
    expect(active()[0]).toHaveAttribute('aria-label', '2 of 2')
  })

  it('jumps to a slide from the progress segments', () => {
    render(<MotionHero slides={slides} intervalMs={5000} />)
    fireEvent.click(screen.getByRole('button', { name: 'Go to slide 2: Power tools' }))
    expect(active()[0]).toHaveAttribute('aria-label', '2 of 2')
  })

  it('advances on arrow keys and when the autoplay clock completes', () => {
    render(<MotionHero slides={slides} intervalMs={5000} />)
    const region = screen.getByRole('region', { name: 'Featured' })
    fireEvent.keyDown(region, { key: 'ArrowRight' })
    expect(active()[0]).toHaveAttribute('aria-label', '2 of 2')
    fireEvent.keyDown(region, { key: 'ArrowLeft' })
    expect(active()[0]).toHaveAttribute('aria-label', '1 of 2')
    expect(autoplay.current.durationMs).toBe(5000)
    act(() => autoplay.current.onComplete())
    expect(active()[0]).toHaveAttribute('aria-label', '2 of 2')
  })

  it('has no arrows or segments and does not advance with a single slide', () => {
    render(<MotionHero slides={[slides[0]]} intervalMs={5000} />)
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    act(() => autoplay.current.onComplete())
    expect(active()[0]).toHaveAttribute('aria-label', '1 of 1')
  })

  it('applies the banner shape when an aspect is set', () => {
    const { container } = render(<MotionHero slides={slides} intervalMs={5000} aspect={2} />)
    expect(container.querySelector('.shape-box')).toHaveStyle({ aspectRatio: '2' })
  })
})
