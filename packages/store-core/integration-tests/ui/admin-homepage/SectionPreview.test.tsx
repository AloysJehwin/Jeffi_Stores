import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

// SectionPreview: a live preview of one homepage section. Business section types render a static note
// with no fetch; every other type debounces a 400ms fetch to the preview route and shows loading /
// error / empty / populated states. We drive the debounce with fake timers and stub fetch.
vi.mock('@/components/admin/homepage/HomepageLock', () => ({ useHomepageLock: () => ({ lockId: null }) }))
vi.mock('@/components/admin/AdminImage', () => ({ default: () => <img alt="" /> }))
vi.mock('@/components/visitor/CategoryIcon', () => ({ default: () => <span data-testid="cat-icon" /> }))
vi.mock('@/components/visitor/home/SlidesSection', () => ({ default: () => <div data-testid="slides-section" /> }))

import SectionPreview from '@/components/admin/homepage/SectionPreview'

const section = (type: string, over: Record<string, any> = {}) => ({ id: 's', type, config: {}, ...over }) as any

function stubFetch(body: any, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })) as any)
}

describe('SectionPreview (business branches — no fetch)', () => {
  it('business_reorder shows its per-business note and never fetches', () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f as any)
    render(<SectionPreview section={section('business_reorder')} />)
    expect(screen.getByText(/most-ordered products/)).toBeInTheDocument()
    expect(f).not.toHaveBeenCalled()
  })

  it('business_quotes shows the quotes note', () => {
    render(<SectionPreview section={section('business_quotes')} />)
    expect(screen.getByText(/open quotes/)).toBeInTheDocument()
  })

  it('business_offers (picked) reflects the picked-source wording', () => {
    render(<SectionPreview section={section('business_offers', { config: { source: 'picked', productIds: ['11111111-1111-4111-8111-111111111111'] } })} />)
    expect(screen.getByText(/products you picked/)).toBeInTheDocument()
  })

  it('business_offers (default source) reflects the discount wording', () => {
    render(<SectionPreview section={section('business_offers', { config: {} })} />)
    expect(screen.getByText(/biggest discount first/)).toBeInTheDocument()
  })
})

describe('SectionPreview (fetch states)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows the loading line before the debounced fetch resolves', () => {
    stubFetch({ kind: 'products', items: [] })
    render(<SectionPreview section={section('product_row')} />)
    expect(screen.getByText(/Loading live preview/)).toBeInTheDocument()
  })

  it('renders populated items once the fetch resolves', async () => {
    stubFetch({ kind: 'products', items: [{ id: 'p1', name: 'Widget' }, { id: 'p2', name: 'Gadget' }] })
    render(<SectionPreview section={section('product_row')} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(screen.getByText('Widget')).toBeInTheDocument()
    expect(screen.getByText('Gadget')).toBeInTheDocument()
    expect(screen.getByText(/Live preview · 2 products/)).toBeInTheDocument()
  })

  it('shows the empty-kind line when items are empty', async () => {
    stubFetch({ kind: 'products', items: [] })
    render(<SectionPreview section={section('product_row')} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(screen.getByText(/no matching products are live/)).toBeInTheDocument()
  })

  it('shows the error line when the fetch is not ok', async () => {
    stubFetch({}, false)
    render(<SectionPreview section={section('product_row')} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(screen.getByText(/Preview unavailable right now/)).toBeInTheDocument()
  })

  it('renders the SlidesSection preview when the kind is slides', async () => {
    stubFetch({ kind: 'slides', items: [{ id: 'x', name: 'Slide' }], slides: { slides: [{}, {}] } })
    render(<SectionPreview section={section('slides')} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(screen.getByTestId('slides-section')).toBeInTheDocument()
    expect(screen.getByText(/Live preview · 2 slides/)).toBeInTheDocument()
  })
})
