import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

let pathname: string | null = '/'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

import AdSense from '@/components/visitor/AdSense'

const w = window as unknown as { adsbygoogle?: unknown[] & { pauseAdRequests?: number } }

describe('AdSense', () => {
  beforeEach(() => {
    pathname = '/'
    delete w.adsbygoogle
    document.documentElement.removeAttribute('data-no-ads')
  })

  it('renders nothing visible and lets ads run on a content page', () => {
    pathname = '/products'
    const { container } = render(<AdSense />)
    expect(container).toBeEmptyDOMElement()
    expect(document.documentElement).not.toHaveAttribute('data-no-ads')
    expect(w.adsbygoogle?.pauseAdRequests).toBe(0)
  })

  it('pauses ad requests and flags the root on a no-ads route', () => {
    pathname = '/cart'
    const { container } = render(<AdSense />)
    expect(container).toBeEmptyDOMElement()
    expect(document.documentElement).toHaveAttribute('data-no-ads')
    expect(w.adsbygoogle?.pauseAdRequests).toBe(1)
  })

  it('keeps an existing queue and resumes when the path becomes allowed again', () => {
    const queue: unknown[] & { pauseAdRequests?: number } = [{ slot: 1 }]
    w.adsbygoogle = queue
    pathname = '/checkout'
    const { rerender } = render(<AdSense />)
    expect(w.adsbygoogle).toBe(queue)
    expect(queue.pauseAdRequests).toBe(1)
    pathname = '/products'
    rerender(<AdSense />)
    expect(queue.pauseAdRequests).toBe(0)
    expect(document.documentElement).not.toHaveAttribute('data-no-ads')
  })

  it('treats a null pathname as the home page', () => {
    pathname = null
    render(<AdSense />)
    expect(w.adsbygoogle?.pauseAdRequests).toBe(0)
  })
})
