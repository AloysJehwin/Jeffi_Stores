import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// MobileCheckoutBar shows a fixed bottom bar on phones (matchMedia) while the in-page summary (watchId)
// is off-screen (IntersectionObserver). We mock useCompare and stub both browser APIs so we can drive each
// branch deterministically.

const useCompare = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/CompareContext', () => ({
  useCompare: () => useCompare(),
}))

import MobileCheckoutBar from '@/components/visitor/cart/MobileCheckoutBar'

// matchMedia(matches) controls the phone branch.
function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  )
}

// IntersectionObserver that immediately reports the given intersecting state.
function stubIO(intersecting: boolean) {
  class IO {
    cb: (entries: { isIntersecting: boolean }[]) => void
    constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
      this.cb = cb
    }
    observe() {
      this.cb([{ isIntersecting: intersecting }])
    }
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', IO as unknown as typeof IntersectionObserver)
}

beforeEach(() => {
  useCompare.mockReturnValue({ compareList: [] })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MobileCheckoutBar', () => {
  it('renders nothing on desktop (matchMedia does not match the phone query)', () => {
    stubMatchMedia(false)
    const { container } = render(
      <MobileCheckoutBar label="Total" amount="₹500.00" watchId="summary">
        <button>Pay</button>
      </MobileCheckoutBar>
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the bar on a phone when the in-page summary is off-screen', () => {
    stubMatchMedia(true)
    stubIO(false)
    // No #summary element -> the effect falls back to summaryInView=false, which also shows the bar.
    render(
      <MobileCheckoutBar label="Order total" amount="₹500.00" watchId="summary">
        <button>Pay now</button>
      </MobileCheckoutBar>
    )
    const region = screen.getByRole('region', { name: 'Order total' })
    expect(region).toBeInTheDocument()
    expect(screen.getByText('₹500.00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay now' })).toBeInTheDocument()
  })

  it('hides the bar on a phone while the watched summary is in view', () => {
    stubMatchMedia(true)
    stubIO(true)
    document.body.innerHTML = '<div id="summary"></div>'
    const { container } = render(
      <MobileCheckoutBar label="Order total" amount="₹500.00" watchId="summary">
        <button>Pay</button>
      </MobileCheckoutBar>
    )
    expect(container).toBeEmptyDOMElement()
    document.body.innerHTML = ''
  })

  it('lifts above the CompareBar when two or more products are queued for compare', () => {
    stubMatchMedia(true)
    stubIO(false)
    useCompare.mockReturnValue({ compareList: [{ id: 'a' }, { id: 'b' }] })
    render(
      <MobileCheckoutBar label="Total" amount="₹500.00" watchId="summary">
        <button>Pay</button>
      </MobileCheckoutBar>
    )
    expect(screen.getByRole('region', { name: 'Order total' })).toHaveClass('bottom-[73px]')
  })
})
