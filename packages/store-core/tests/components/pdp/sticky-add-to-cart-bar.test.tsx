import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

const { compare } = vi.hoisted(() => ({ compare: { list: [] as unknown[] } }))

vi.mock('@/contexts/CompareContext', () => ({ useCompare: () => ({ compareList: compare.list }) }))

import StickyAddToCartBar from '@/components/visitor/pdp/StickyAddToCartBar'
import { PDP_BUY_BUTTONS_ID, PDP_OPTIONS_ID } from '@/components/visitor/pdp/pdp'

type Entry = Pick<IntersectionObserverEntry, 'isIntersecting'> & {
  boundingClientRect: { top: number; bottom: number }
  rootBounds: { top: number } | null
}

let observer: { fire: (entry: Entry) => void; observed: Element | null } | null = null

class FakeIntersectionObserver {
  observed: Element | null = null
  constructor(private readonly callback: (entries: Entry[]) => void) {
    observer = this
  }
  observe(el: Element) {
    this.observed = el
  }
  disconnect() {}
  fire(entry: Entry) {
    this.callback([entry])
  }
}

const scrolledPast: Entry = {
  isIntersecting: false,
  boundingClientRect: { top: -40, bottom: 20 },
  rootBounds: { top: 80 },
}
const notReachedYet: Entry = {
  isIntersecting: false,
  boundingClientRect: { top: 900, bottom: 980 },
  rootBounds: { top: 80 },
}
const inView: Entry = { isIntersecting: true, boundingClientRect: { top: 300, bottom: 400 }, rootBounds: { top: 80 } }

const props = {
  name: 'Taparia Torque Wrench',
  image: null,
  price: 1234,
  mrp: 1500,
  unitLabel: null,
  quantity: 1,
  adding: false,
  onAdd: vi.fn(),
}

let buttons: HTMLDivElement
let options: HTMLDivElement

beforeEach(() => {
  compare.list = []
  observer = null
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  buttons = document.createElement('div')
  buttons.id = PDP_BUY_BUTTONS_ID
  options = document.createElement('div')
  options.id = PDP_OPTIONS_ID
  options.scrollIntoView = vi.fn()
  document.body.append(buttons, options)
})

afterEach(() => {
  cleanup()
  buttons.remove()
  options.remove()
  vi.unstubAllGlobals()
})

describe('StickyAddToCartBar', () => {
  it('watches the main buy buttons and stays hidden until they scroll away above the header', () => {
    render(<StickyAddToCartBar {...props} action="add" />)
    expect(observer?.observed).toBe(buttons)
    expect(screen.queryByRole('region')).toBeNull()

    act(() => observer!.fire(notReachedYet))
    expect(screen.queryByRole('region')).toBeNull()

    act(() => observer!.fire(scrolledPast))
    expect(screen.getByRole('region', { name: 'Quick add to cart' })).toBeTruthy()
    expect(screen.getByText('Rs. 1,234.00')).toBeTruthy()
    expect(screen.getByText('Rs. 1,500.00')).toBeTruthy()

    act(() => observer!.fire(inView))
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('runs the main add-to-cart handler', () => {
    const onAdd = vi.fn()
    render(<StickyAddToCartBar {...props} quantity={3} onAdd={onAdd} action="add" />)
    act(() => observer!.fire(scrolledPast))
    expect(screen.getByText('Qty 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Cart' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('scrolls to the option selector when a choice is still needed', () => {
    const onAdd = vi.fn()
    render(<StickyAddToCartBar {...props} onAdd={onAdd} action="choose" />)
    act(() => observer!.fire(scrolledPast))
    fireEvent.click(screen.getByRole('button', { name: 'Choose options' }))
    expect(options.scrollIntoView).toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('never shows when the product cannot be bought', () => {
    render(<StickyAddToCartBar {...props} action={null} />)
    act(() => observer!.fire(scrolledPast))
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('sits above the CompareBar while products are queued for comparison', () => {
    compare.list = [{ id: 'a' }, { id: 'b' }]
    render(<StickyAddToCartBar {...props} action="add" />)
    act(() => observer!.fire(scrolledPast))
    const bar = screen.getByRole('region', { name: 'Quick add to cart' })
    expect(bar.className).toContain('bottom-[73px]')
    expect(bar.className).not.toContain('bottom-0')
  })
})
