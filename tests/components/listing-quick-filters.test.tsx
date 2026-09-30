import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const nav = vi.hoisted(() => ({ push: vi.fn(), params: new URLSearchParams() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push }),
  useSearchParams: () => nav.params,
}))

import QuickFilterChips from '@/components/visitor/listing/QuickFilterChips'
import ListingPromoBanner, { pickPromoOffer, type PromoOffer } from '@/components/visitor/listing/ListingPromoBanner'
import {
  categoryChipScope,
  chipSelected,
  rankChips,
  splitList,
  toggleChip,
  type CategoryNode,
} from '@/components/visitor/listing/quick-filters'

afterEach(cleanup)

const TAPARIA = { id: 'b-taparia', slug: 'taparia', name: 'Taparia' }
const TVS = { id: 'b-tvs', slug: 'tvs', name: 'TVS' }
const SCREWS = { id: 'c-screws', slug: 'screws', name: 'Screws' }
const BOLTS = { id: 'c-bolts', slug: 'bolts', name: 'Bolts' }

const CATEGORIES: CategoryNode[] = [
  { id: 'fasteners', slug: 'fasteners', parent_category_id: null },
  { id: 'c-screws', slug: 'screws', parent_category_id: 'fasteners' },
  { id: 'c-bolts', slug: 'bolts', parent_category_id: 'fasteners' },
  { id: 'tools', slug: 'tools', parent_category_id: null },
  { id: 'c-pliers', slug: 'pliers', parent_category_id: 'tools' },
]

function pushedParams(): URLSearchParams {
  const url = nav.push.mock.calls.at(-1)![0] as string
  expect(url.startsWith('/products')).toBe(true)
  return new URLSearchParams(url.split('?')[1] ?? '')
}

describe('quick filter helpers', () => {
  it('splits comma lists and ignores blanks', () => {
    expect(splitList('a, b,,c')).toEqual(['a', 'b', 'c'])
    expect(splitList(null)).toEqual([])
  })

  it('treats a chip as selected by id or slug', () => {
    expect(chipSelected(TVS, ['b-tvs'])).toBe(true)
    expect(chipSelected(TVS, ['tvs'])).toBe(true)
    expect(chipSelected(TVS, ['taparia'])).toBe(false)
  })

  it('toggles a chip in the comma list the way the sidebar does', () => {
    expect(toggleChip(null, TVS)).toBe('b-tvs')
    expect(toggleChip('b-taparia', TVS)).toBe('b-taparia,b-tvs')
    expect(toggleChip('b-taparia,tvs', TVS)).toBe('b-taparia')
    expect(toggleChip('b-tvs', TVS)).toBeNull()
  })

  it('scopes category chips to the children of a selected parent', () => {
    expect(categoryChipScope(['fasteners'], CATEGORIES)).toEqual(['c-screws', 'c-bolts'])
  })

  it('scopes category chips to the siblings of a selected leaf, by id or slug', () => {
    expect(categoryChipScope(['screws'], CATEGORIES)).toEqual(['c-screws', 'c-bolts'])
    expect(categoryChipScope(['fasteners', 'c-bolts'], CATEGORIES)).toEqual(['c-screws', 'c-bolts'])
  })

  it('offers every category when none (or only unknown ones) are selected', () => {
    expect(categoryChipScope([], CATEGORIES)).toBeNull()
    expect(categoryChipScope(['nope'], CATEGORIES)).toBeNull()
  })

  it('ranks by count, breaks ties by name, and keeps a selected chip below the cut', () => {
    const rows = [
      { ...TVS, count: 5 },
      { ...TAPARIA, count: 9 },
      { id: 'b-gmf', slug: 'gmf', name: 'GMF', count: 5 },
      { id: 'b-totem', slug: 'totem', name: 'Totem', count: 1 },
    ]
    expect(rankChips(rows, [], 2).map(c => c.name)).toEqual(['Taparia', 'GMF'])
    expect(rankChips(rows, ['totem'], 2).map(c => c.name)).toEqual(['Taparia', 'GMF', 'Totem'])
    expect(rankChips(rows, [], 2)[0]).toEqual(TAPARIA)
  })

  it('hides a lone chip that would not narrow anything, unless it is selected', () => {
    expect(rankChips([{ ...TVS, count: 3 }], [], 4)).toEqual([])
    expect(rankChips([{ ...TVS, count: 3 }], ['b-tvs'], 4)).toEqual([TVS])
  })
})

describe('QuickFilterChips', () => {
  it('shows the active state from the URL', () => {
    nav.params = new URLSearchParams('inStock=1&brand=tvs&category=c-screws')
    render(<QuickFilterChips showInStock showOnSale={false} categories={[SCREWS, BOLTS]} brands={[TAPARIA, TVS]} />)

    expect(screen.getByRole('button', { name: 'In Stock' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('button', { name: 'On Sale' })).toBeNull()
    expect(screen.getByRole('button', { name: 'TVS' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Taparia' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Screws' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('adds a brand while keeping the other params and resetting the page', () => {
    nav.params = new URLSearchParams('search=spanner&brand=b-taparia&page=3')
    render(<QuickFilterChips showInStock={false} showOnSale={false} categories={[]} brands={[TAPARIA, TVS]} />)

    fireEvent.click(screen.getByRole('button', { name: 'TVS' }))

    const params = pushedParams()
    expect(params.get('brand')).toBe('b-taparia,b-tvs')
    expect(params.get('search')).toBe('spanner')
    expect(params.has('page')).toBe(false)
  })

  it('clears an active category chip and an active in-stock chip', () => {
    nav.params = new URLSearchParams('category=fasteners,c-screws&inStock=1')
    render(<QuickFilterChips showInStock showOnSale categories={[SCREWS, BOLTS]} brands={[]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Screws' }))
    expect(pushedParams().get('category')).toBe('fasteners')

    fireEvent.click(screen.getByRole('button', { name: 'In Stock' }))
    expect(pushedParams().has('inStock')).toBe(false)
  })

  it('keeps an active flag chip visible even when its facet count is zero', () => {
    nav.params = new URLSearchParams('onSale=1')
    render(<QuickFilterChips showInStock={false} showOnSale={false} categories={[]} brands={[]} />)
    expect(screen.getByRole('button', { name: 'On Sale' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('renders nothing when there is nothing to offer', () => {
    nav.params = new URLSearchParams()
    const { container } = render(
      <QuickFilterChips showInStock={false} showOnSale={false} categories={[]} brands={[]} />
    )
    expect(container.innerHTML).toBe('')
  })
})

const OFFER: PromoOffer = {
  slug: 'diwali',
  title: 'Diwali deals',
  subtitle: 'Up to 30% off',
  badge_text: 'Diwali',
  badge_color: 'bg-rose-600',
  image_url: 'https://cdn.example/d.jpg',
  image_url_mobile: null,
  blurhash: null,
  blurhash_mobile: null,
  cta_label: null,
}

describe('pickPromoOffer', () => {
  const offers = [
    { slug: 'a', image_url: 'a.jpg', image_url_mobile: null },
    { slug: 'no-image', image_url: null, image_url_mobile: null },
    { slug: 'b', image_url: null, image_url_mobile: 'b.jpg' },
    { slug: 'empty', image_url: 'e.jpg', image_url_mobile: null },
  ]
  const eligibleSlugs = new Set(['a', 'b', 'no-image'])

  it('only features offers with an image that hold products', () => {
    expect(pickPromoOffer(offers, { page: 1, eligibleSlugs })?.slug).toBe('a')
    expect(pickPromoOffer(offers, { page: 2, eligibleSlugs })?.slug).toBe('b')
    expect(pickPromoOffer(offers, { page: 3, eligibleSlugs })?.slug).toBe('a')
  })

  it('skips the offer that is already the active filter', () => {
    expect(pickPromoOffer(offers, { page: 1, activeSlug: 'a', eligibleSlugs })?.slug).toBe('b')
    expect(pickPromoOffer(offers, { page: 1, activeSlug: 'a', eligibleSlugs: new Set(['a']) })).toBeNull()
  })

  it('falls back to the first candidate for a bad page number', () => {
    expect(pickPromoOffer(offers, { page: Number.NaN, eligibleSlugs })?.slug).toBe('a')
  })
})

describe('ListingPromoBanner', () => {
  it('links to the offer-filtered listing like the offer slider does', () => {
    render(<ListingPromoBanner offer={OFFER} />)
    const link = screen.getByRole('link', { name: 'Shop Diwali deals' })
    expect(link.getAttribute('href')).toBe('/products?offer=diwali')
    expect(screen.getByText('Diwali').className).toContain('bg-rose-600')
    expect(screen.getByText('Shop the offer')).toBeTruthy()
  })

  it('falls back to the accent colour when the badge colour is not a class', () => {
    render(<ListingPromoBanner offer={{ ...OFFER, badge_color: '#ff0000' }} />)
    expect(screen.getByText('Diwali').className).toContain('bg-accent-500')
  })

  it('renders nothing without an image', () => {
    const { container } = render(<ListingPromoBanner offer={{ ...OFFER, image_url: null }} />)
    expect(container.innerHTML).toBe('')
  })
})
