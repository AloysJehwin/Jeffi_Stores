import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

let pathname = '/'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
const captureAttribution = vi.fn()
vi.mock('@/lib/shared/attribution', () => ({ captureAttribution: () => captureAttribution() }))

import PageTracker from '@/components/visitor/PageTracker'

const beacon = vi.fn()
const sent = () => beacon.mock.calls.map(c => ({ url: c[0], body: JSON.parse(c[1]) }))

describe('PageTracker', () => {
  beforeEach(() => {
    beacon.mockReset()
    captureAttribution.mockReset()
    captureAttribution.mockReturnValue(null)
    sessionStorage.clear()
    pathname = '/'
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon })
  })

  it.each([
    ['/', 'home'],
    ['/categories', 'categories'],
    ['/categories/audio', 'category'],
    ['/products/halo-speaker', 'product'],
    ['/cart', 'cart'],
    ['/checkout/pay', 'checkout'],
    ['/account/orders/o1', 'order_placed'],
    ['/search?q=x', 'search'],
  ])('classifies %s as %s and beacons it', (path, page) => {
    pathname = path
    const { container } = render(<PageTracker />)
    expect(container).toBeEmptyDOMElement()
    expect(sent()).toHaveLength(1)
    expect(sent()[0].url).toBe('/api/track')
    expect(sent()[0].body).toMatchObject({ page, path })
  })

  it('does not beacon untracked pages, but still captures attribution (an ad can land anywhere)', () => {
    pathname = '/about'
    render(<PageTracker />)
    expect(beacon).not.toHaveBeenCalled()
    expect(captureAttribution).toHaveBeenCalled()
  })

  it('does not treat the orders list as an order page', () => {
    pathname = '/account/orders'
    render(<PageTracker />)
    expect(beacon).not.toHaveBeenCalled()
  })

  it('keeps one session id for the tab and sends the campaign attribution', () => {
    captureAttribution.mockReturnValue({ utm_source: 'g', utm_medium: 'cpc', utm_campaign: 'sale', gclid: 'x', gbraid: null, wbraid: null, extra: 'dropped' })
    pathname = '/cart'
    const { rerender } = render(<PageTracker />)
    pathname = '/checkout'
    rerender(<PageTracker />)
    const [a, b] = sent()
    expect(a.body.sessionId).toBeTruthy()
    expect(b.body.sessionId).toBe(a.body.sessionId)
    expect(sessionStorage.getItem('jeffi_sid')).toBe(a.body.sessionId)
    expect(a.body.attribution).toEqual({ utm_source: 'g', utm_medium: 'cpc', utm_campaign: 'sale', gclid: 'x', gbraid: null, wbraid: null })
  })

  it('tracks a route once, not on every re-render', () => {
    pathname = '/cart'
    const { rerender } = render(<PageTracker />)
    rerender(<PageTracker />)
    expect(beacon).toHaveBeenCalledTimes(1)
  })

  it('still tracks when session storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    pathname = '/cart'
    render(<PageTracker />)
    expect(sent()[0].body.sessionId).toBeTruthy()
  })
})
