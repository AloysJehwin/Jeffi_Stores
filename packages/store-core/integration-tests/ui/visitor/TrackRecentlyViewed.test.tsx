import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const track = vi.fn()
vi.mock('@/components/visitor/RecentlyViewed', () => ({ trackRecentlyViewed: (p: any) => track(p) }))

import TrackRecentlyViewed from '@/components/visitor/TrackRecentlyViewed'

describe('TrackRecentlyViewed', () => {
  beforeEach(() => track.mockReset())

  it('records the product on mount with defaults for the optional fields and renders nothing', () => {
    const { container } = render(<TrackRecentlyViewed id="p1" name="Speaker" slug="speaker" price={999} image={null} />)
    expect(container).toBeEmptyDOMElement()
    expect(track).toHaveBeenCalledWith({
      id: 'p1', name: 'Speaker', slug: 'speaker', price: 999, mrp: null, brand: null, inStock: true, image: null, categoryId: null,
    })
  })

  it('passes optional fields through and re-tracks only when the product changes', () => {
    const props = { id: 'p1', name: 'Speaker', slug: 'speaker', price: 999, mrp: 1299, brand: 'Halo', inStock: false, image: '/s.png', categoryId: 'c1' }
    const { rerender } = render(<TrackRecentlyViewed {...props} />)
    expect(track.mock.calls[0][0]).toMatchObject({ mrp: 1299, brand: 'Halo', inStock: false, image: '/s.png', categoryId: 'c1' })
    rerender(<TrackRecentlyViewed {...props} />)
    expect(track).toHaveBeenCalledTimes(1)
    rerender(<TrackRecentlyViewed id="p2" name="Sub" slug="sub" price={500} image={null} />)
    expect(track).toHaveBeenCalledTimes(2)
    expect(track.mock.calls[1][0].id).toBe('p2')
  })
})
