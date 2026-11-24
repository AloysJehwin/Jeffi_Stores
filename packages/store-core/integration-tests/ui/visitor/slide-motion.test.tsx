import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Spring smoothing and transform propagation are frame-driven; compute them synchronously so values are deterministic.
vi.mock('motion/react', async () => {
  const actual = await vi.importActual<any>('motion/react')
  return { ...actual, useSpring: (mv: any) => mv, useTransform: (mv: any, fn: (v: number) => number) => ({ get: () => fn(mv.get()) }) }
})

import {
  EASE,
  FADE_S,
  KEN_BURNS,
  RevealWords,
  headlineVariants,
  riseVariants,
  usePointerParallax,
  wordVariants,
} from '@/components/visitor/slides/slide-motion'

describe('slide-motion variants', () => {
  it('exposes the timing constants', () => {
    expect(FADE_S).toBe(0.7)
    expect(KEN_BURNS).toBe(0.06)
    expect(EASE).toHaveLength(4)
  })

  it('headline staggers its words, but not under reduced motion', () => {
    expect((headlineVariants(false).show as any).transition).toEqual({ staggerChildren: 0.06, delayChildren: 0.15 })
    expect((headlineVariants(true).show as any).transition).toEqual({ staggerChildren: 0 })
  })

  it('word variants wait out the crossfade when hiding, instantly under reduced motion', () => {
    expect((wordVariants(false).hidden as any).transition.delay).toBe(FADE_S)
    expect((wordVariants(true).hidden as any).transition.delay).toBe(0)
    expect((wordVariants(true).show as any).transition).toEqual({ duration: 0 })
    expect((wordVariants(false).show as any).transition.ease).toBe(EASE)
  })

  it('rise variants carry the requested delay', () => {
    expect((riseVariants(false, 0.3).show as any).transition.delay).toBe(0.3)
    expect((riseVariants(true, 0.3).show as any).transition).toEqual({ duration: 0 })
    expect((riseVariants(true, 0.3).hidden as any).transition.delay).toBe(0)
  })
})

describe('RevealWords', () => {
  it('splits the headline into one span per word, space-separated', () => {
    const { container } = render(<h1><RevealWords text="Big  summer sale" reduced={false} /></h1>)
    expect(screen.getByText('Big')).toBeInTheDocument()
    expect(screen.getByText('summer')).toBeInTheDocument()
    expect(screen.getByText('sale')).toBeInTheDocument()
    expect(container.querySelectorAll('span.inline-block.overflow-hidden')).toHaveLength(3)
    expect(container.textContent).toBe('Big summer sale')
  })
})

function Probe({ reduced = false }: { reduced?: boolean }) {
  const { x, y, onPointerMove, onPointerLeave } = usePointerParallax(reduced, { x: 10, y: 20 })
  return (
    <div
      data-testid="area"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      ref={el => {
        if (el) el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect
      }}
    >
      <output data-testid="xy">{`${x.get()},${y.get()}`}</output>
      <button onClick={() => (document.title = `${x.get()},${y.get()}`)}>read</button>
    </div>
  )
}
const read = () => {
  fireEvent.click(screen.getByText('read'))
  return document.title
}

describe('usePointerParallax', () => {
  it('maps a mouse position to a scaled offset from the centre', () => {
    render(<Probe />)
    fireEvent.pointerMove(screen.getByTestId('area'), { pointerType: 'mouse', clientX: 200, clientY: 100 })
    expect(read()).toBe('10,20')
    fireEvent.pointerMove(screen.getByTestId('area'), { pointerType: 'mouse', clientX: 100, clientY: 50 })
    expect(read()).toBe('0,0')
  })

  it('ignores touch input and resets on mouse leave', () => {
    render(<Probe />)
    const area = screen.getByTestId('area')
    fireEvent.pointerMove(area, { pointerType: 'touch', clientX: 200, clientY: 100 })
    expect(read()).toBe('0,0')
    fireEvent.pointerMove(area, { pointerType: 'mouse', clientX: 0, clientY: 0 })
    expect(read()).toBe('-10,-20')
    fireEvent.pointerLeave(area, { pointerType: 'touch' })
    expect(read()).toBe('-10,-20')
    fireEvent.pointerLeave(area, { pointerType: 'mouse' })
    expect(read()).toBe('0,0')
  })

  it('does not move under reduced motion', () => {
    render(<Probe reduced />)
    fireEvent.pointerMove(screen.getByTestId('area'), { pointerType: 'mouse', clientX: 200, clientY: 100 })
    expect(read()).toBe('0,0')
  })
})
