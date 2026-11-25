import { describe, it, expect, beforeEach } from 'vitest'
import { screen, fireEvent, within } from '@testing-library/react'
import BackInStockEditor from '@/components/admin/homepage/editors/BackInStockEditor'
import BundleSpotlightEditor from '@/components/admin/homepage/editors/BundleSpotlightEditor'
import CategoryTabsEditor from '@/components/admin/homepage/editors/CategoryTabsEditor'
import CountdownDealEditor from '@/components/admin/homepage/editors/CountdownDealEditor'
import DealOfTheDayEditor from '@/components/admin/homepage/editors/DealOfTheDayEditor'
import FeaturedForYouEditor from '@/components/admin/homepage/editors/FeaturedForYouEditor'
import ProductRowEditor from '@/components/admin/homepage/editors/ProductRowEditor'
import ProductSpotlightEditor from '@/components/admin/homepage/editors/ProductSpotlightEditor'
import RecentlyViewedEditor from '@/components/admin/homepage/editors/RecentlyViewedEditor'
import TestimonialsEditor from '@/components/admin/homepage/editors/TestimonialsEditor'
import type { SectionOptions } from '@/lib/catalog/homepage-editor-options'
import { renderEditor, input, commit, choose, combo, stubProductFetch, P1, P2 } from './editor-kit'

// Homepage editors for product / catalogue driven sections. Edits persist through onChange + onSave.
beforeEach(() => {
  stubProductFetch()
})

const counts = (over: Record<string, number> = {}) =>
  ({ counts: { featured: 12, newArrivals: 5, bestSellers: 7, onSale: 3, bundles: 0, approvedReviews: 0, ...over } }) as unknown as SectionOptions

describe('BackInStockEditor', () => {
  it('shows the 14 day default and saves a capped window', () => {
    const { onSave } = renderEditor(BackInStockEditor, 'back_in_stock')
    expect(input('Restocked within (days)')).toHaveValue(14)
    commit(input('Restocked within (days)'), '200')
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { days: 90 } })
  })

  it('saves product count and layout, and locks without write access', () => {
    const { onSave, unmount } = renderEditor(BackInStockEditor, 'back_in_stock')
    commit(input('How many products'), '6')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { limit: 6 } })
    choose('Layout', 'Carousel')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { layout: 'carousel' } })
    unmount()
    renderEditor(BackInStockEditor, 'back_in_stock', {}, { canWrite: false })
    expect(input('Restocked within (days)')).toBeDisabled()
  })
})

describe('BundleSpotlightEditor', () => {
  it('explains the empty-picker behaviour with the live bundle count', () => {
    renderEditor(BundleSpotlightEditor, 'bundle_spotlight', {}, { options: counts({ bundles: 4 }) })
    expect(screen.getByText(/every product marked as a bundle \(4 live\)/)).toBeInTheDocument()
    expect(screen.queryByText(/No live products are marked as bundles/)).toBeNull()
  })

  it('warns when there are no bundles and nothing is picked', () => {
    renderEditor(BundleSpotlightEditor, 'bundle_spotlight', {}, { options: counts({ bundles: 0 }) })
    expect(screen.getByText(/No live products are marked as bundles yet/)).toBeInTheDocument()
  })

  it('shows picked products and saves a removal', async () => {
    const { onSave } = renderEditor(BundleSpotlightEditor, 'bundle_spotlight', { config: { productIds: [P1, P2] } })
    expect(await screen.findByText('Cordless Drill')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Cordless Drill' }))
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { productIds: [P2] } })
  })

  it('saves the product count', () => {
    const { onSave } = renderEditor(BundleSpotlightEditor, 'bundle_spotlight')
    commit(input('How many products'), '3')
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { limit: 3 } })
  })
})

describe('CategoryTabsEditor', () => {
  const options = {
    counts: {},
    topCategories: [
      { value: 'c1', label: 'Power tools' },
      { value: 'c2', label: 'Hand tools' },
      { value: 'c3', label: 'Paint' },
    ],
  } as unknown as SectionOptions

  it('lists categories and explains that none are ticked', () => {
    renderEditor(CategoryTabsEditor, 'category_tabs', {}, { options })
    expect(screen.getByLabelText('Power tools')).not.toBeChecked()
    expect(screen.getByText(/None ticked/)).toBeInTheDocument()
  })

  it('saves a tick appended to the picked list, and an untick removed from it', () => {
    // ids must be GUIDs to be read back; use them as category values.
    const guid = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`
    const opts = {
      counts: {},
      topCategories: [
        { value: guid(1), label: 'Power tools' },
        { value: guid(2), label: 'Hand tools' },
      ],
    } as unknown as SectionOptions
    const { onSave, unmount } = renderEditor(CategoryTabsEditor, 'category_tabs', {}, { options: opts })
    fireEvent.click(screen.getByLabelText('Hand tools'))
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { categoryIds: [guid(2)] } })
    unmount()
    const r = renderEditor(CategoryTabsEditor, 'category_tabs', { config: { categoryIds: [guid(1), guid(2)] } }, { options: opts })
    expect(screen.getByText(/Showing 2 picked categories/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Hand tools/).closest('label')).toHaveTextContent('2')
    fireEvent.click(screen.getByLabelText(/Power tools/))
    expect(r.onSave).toHaveBeenCalledWith('sec-1', { config: { categoryIds: [guid(2)] } })
  })

  it('saves the tab count (capped at 8) and products per tab', () => {
    const { onSave } = renderEditor(CategoryTabsEditor, 'category_tabs', {}, { options })
    commit(input('Number of tabs'), '20')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { tabs: 8 } })
    commit(input('Products per tab'), '5')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { limit: 5 } })
  })

  it('disables ticking without write access', () => {
    renderEditor(CategoryTabsEditor, 'category_tabs', {}, { options, canWrite: false })
    expect(screen.getByLabelText('Paint')).toBeDisabled()
  })
})

describe('CountdownDealEditor', () => {
  it('asks for a product while none is picked', () => {
    renderEditor(CountdownDealEditor, 'countdown_deal')
    expect(screen.getByText(/Pick a product. The section stays hidden/)).toBeInTheDocument()
    expect(screen.getByText('No countdown')).toBeInTheDocument()
  })

  it('shows the picked product and saves it cleared', async () => {
    const { onSave } = renderEditor(CountdownDealEditor, 'countdown_deal', { config: { productId: P1 } })
    expect(await screen.findByText('Cordless Drill')).toBeInTheDocument()
    expect(screen.queryByText(/Pick a product/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Cordless Drill' }))
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { productId: null } })
  })

  it('warns when the countdown has already ended', () => {
    renderEditor(CountdownDealEditor, 'countdown_deal', { config: { productId: P1, endsAt: '2020-01-05T10:00:00.000Z' } })
    expect(screen.getByText(/The countdown has ended/)).toBeInTheDocument()
  })

  it('does not warn for a future end time', () => {
    renderEditor(CountdownDealEditor, 'countdown_deal', { config: { productId: P1, endsAt: '2099-01-05T10:00:00.000Z' } })
    expect(screen.queryByText(/The countdown has ended/)).toBeNull()
  })

  it('clears the end time through the picker', () => {
    const { onSave } = renderEditor(CountdownDealEditor, 'countdown_deal', {
      config: { productId: P1, endsAt: '2099-01-15T10:00:00.000Z' },
    })
    fireEvent.click(screen.getByText(/Jan 2099/))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { productId: P1, endsAt: null } })
  })

  it('saves the button label and heading as row columns', () => {
    const { onSave } = renderEditor(CountdownDealEditor, 'countdown_deal')
    expect(input('Button label')).toHaveValue('Grab the deal')
    commit(input('Button label'), 'Buy now')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { ctaLabel: 'Buy now' })
    commit(input('Heading'), 'Flash sale')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { title: 'Flash sale' })
  })
})

describe('DealOfTheDayEditor', () => {
  it('shows the count and saves a new one', () => {
    const { onSave } = renderEditor(DealOfTheDayEditor, 'deal_of_the_day')
    expect(input('How many deals')).toHaveValue(4)
    commit(input('How many deals'), '2')
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { limit: 2 } })
  })

  it('warns that a past countdown reads as expired', () => {
    renderEditor(DealOfTheDayEditor, 'deal_of_the_day', { config: { countdownEndsAt: '2020-01-05T10:00:00.000Z' } })
    expect(screen.getByText(/timer will read as expired/)).toBeInTheDocument()
  })

  it('clears a future countdown', () => {
    const { onSave } = renderEditor(DealOfTheDayEditor, 'deal_of_the_day', {
      config: { countdownEndsAt: '2099-03-15T10:00:00.000Z' },
    })
    expect(screen.queryByText(/timer will read as expired/)).toBeNull()
    fireEvent.click(screen.getByText(/Mar 2099/))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { countdownEndsAt: null } })
  })

  it('saves a picked day as an ISO timestamp', () => {
    const { onSave } = renderEditor(DealOfTheDayEditor, 'deal_of_the_day', {
      config: { countdownEndsAt: '2099-03-15T10:00:00.000Z' },
    })
    fireEvent.click(screen.getByText(/Mar 2099/))
    fireEvent.click(screen.getByRole('button', { name: '20' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    const saved = onSave.mock.calls.at(-1)![1].config.countdownEndsAt
    expect(saved).toMatch(/^2099-03-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
  })
})

describe('FeaturedForYouEditor', () => {
  it('explains the personalised section and only edits the heading', () => {
    const { onSave } = renderEditor(FeaturedForYouEditor, 'featured_for_you')
    expect(screen.getByText(/personalised per shopper/)).toBeInTheDocument()
    expect(input('Heading')).toHaveValue('Featured For You')
    commit(input('Heading'), 'Just for you')
    expect(onSave).toHaveBeenCalledWith('sec-1', { title: 'Just for you' })
  })

  it('locks the heading without write access', () => {
    renderEditor(FeaturedForYouEditor, 'featured_for_you', {}, { canWrite: false })
    expect(input('Heading')).toBeDisabled()
  })
})

describe('ProductRowEditor', () => {
  it('defaults to featured products with the available count in the hint', () => {
    renderEditor(ProductRowEditor, 'product_row', {}, { options: counts() })
    expect(combo('Products')).toHaveTextContent('Featured products')
    expect(screen.getByText(/12 available/)).toBeInTheDocument()
    expect(screen.queryByText('Category')).toBeNull()
  })

  it('switches the source and saves it', () => {
    const { onSave } = renderEditor(ProductRowEditor, 'product_row', {}, { options: counts() })
    choose('Products', 'Best sellers')
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { source: 'best_sellers' } })
  })

  it('shows a category select with a fallback note until a category is chosen', () => {
    const options = { ...counts(), categories: [{ value: 'drills', label: 'Drills' }, { value: 'saws', label: 'Saws' }] } as unknown as SectionOptions
    const { onSave } = renderEditor(ProductRowEditor, 'product_row', { config: { source: 'category' } }, { options })
    expect(screen.getByText(/falls back to featured products/)).toBeInTheDocument()
    choose('Category', 'Saws')
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { source: 'category', categorySlug: 'saws' } })
  })

  it('reveals the "counts as new" field only when the Just Landed badge is on', () => {
    const { onSave, unmount } = renderEditor(ProductRowEditor, 'product_row')
    expect(screen.queryByText('Counts as new for (days)')).toBeNull()
    fireEvent.click(screen.getByRole('switch'))
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { justLanded: true } })
    unmount()
    renderEditor(ProductRowEditor, 'product_row', { config: { justLanded: true } })
    expect(input('Counts as new for (days)')).toHaveValue(30)
  })

  it('saves count, layout, heading and button link', () => {
    const { onSave } = renderEditor(ProductRowEditor, 'product_row')
    commit(input('How many to show'), '10')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { limit: 10 } })
    choose('Layout', 'Carousel')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { layout: 'carousel' } })
    commit(input('Heading'), 'Fresh in')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { title: 'Fresh in' })
    expect(input('Button link')).toHaveValue('/products')
  })

  it('locks every control without write access', () => {
    renderEditor(ProductRowEditor, 'product_row', {}, { canWrite: false })
    expect(combo('Products')).toBeDisabled()
    expect(screen.getByRole('switch')).toBeDisabled()
  })
})

describe('ProductSpotlightEditor', () => {
  it('asks for a product while none is picked', () => {
    renderEditor(ProductSpotlightEditor, 'product_spotlight')
    expect(screen.getByText(/Pick a product. The section stays hidden/)).toBeInTheDocument()
    expect(screen.getByText('No tiles yet. Add one to show it on the homepage.')).toBeInTheDocument()
  })

  it('saves the headline, or null when cleared', () => {
    const { onSave } = renderEditor(ProductSpotlightEditor, 'product_spotlight', { config: { headline: 'Big drill' } })
    expect(input('Headline')).toHaveValue('Big drill')
    commit(input('Headline'), '')
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { headline: null } })
  })

  it('adds, edits, reorders and removes callouts as plain strings', () => {
    const { onSave } = renderEditor(ProductSpotlightEditor, 'product_spotlight', {
      config: { callouts: ['Free delivery', '2-year warranty'] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add tile' }))
    expect(onSave).toHaveBeenLastCalledWith('sec-1', {
      config: { callouts: ['Free delivery', '2-year warranty', ''] },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Down' })[0])
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { callouts: ['2-year warranty', 'Free delivery'] } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { callouts: ['2-year warranty'] } })
    commit(input('Callout', 0), 'Ships today')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { callouts: ['Ships today', '2-year warranty'] } })
  })

  it('stops adding callouts at four', () => {
    renderEditor(ProductSpotlightEditor, 'product_spotlight', { config: { callouts: ['a', 'b', 'c', 'd'] } })
    expect(screen.getByRole('button', { name: 'Add tile' })).toBeDisabled()
  })
})

describe('RecentlyViewedEditor', () => {
  it('shows the defaults and saves a capped threshold', () => {
    const { onSave } = renderEditor(RecentlyViewedEditor, 'recently_viewed')
    expect(input('Heading')).toHaveValue('Recently viewed')
    expect(input('Show after this many views')).toHaveValue(2)
    commit(input('Show after this many views'), '40')
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { minItems: 12 } })
  })

  it('saves the product count and heading; locks without write access', () => {
    const { onSave, unmount } = renderEditor(RecentlyViewedEditor, 'recently_viewed')
    commit(input('How many products'), '4')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { limit: 4 } })
    commit(input('Heading'), 'Pick up where you left off')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { title: 'Pick up where you left off' })
    unmount()
    renderEditor(RecentlyViewedEditor, 'recently_viewed', {}, { canWrite: false })
    expect(input('How many products')).toBeDisabled()
  })
})

describe('TestimonialsEditor', () => {
  it('warns that the section stays hidden with no approved reviews', () => {
    renderEditor(TestimonialsEditor, 'testimonials', {}, { options: counts({ approvedReviews: 0 }) })
    expect(screen.getByText(/no approved reviews yet/)).toBeInTheDocument()
  })

  it('has no warning with approved reviews or unknown counts', () => {
    const { unmount } = renderEditor(TestimonialsEditor, 'testimonials', {}, { options: counts({ approvedReviews: 9 }) })
    expect(screen.queryByText(/no approved reviews yet/)).toBeNull()
    unmount()
    renderEditor(TestimonialsEditor, 'testimonials')
    expect(screen.queryByText(/no approved reviews yet/)).toBeNull()
  })

  it('shows the minimum rating (default 4 stars) and saves a numeric change', () => {
    const { onSave } = renderEditor(TestimonialsEditor, 'testimonials')
    expect(combo('Minimum rating')).toHaveTextContent('4 stars and up')
    choose('Minimum rating', '5 stars only')
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { minRating: 5 } })
  })

  it('saves count and layout', () => {
    const { onSave } = renderEditor(TestimonialsEditor, 'testimonials')
    commit(input('How many reviews'), '9')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { limit: 9 } })
    choose('Layout', 'Carousel')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { layout: 'carousel' } })
  })

  it('locks the rating select without write access', () => {
    renderEditor(TestimonialsEditor, 'testimonials', {}, { canWrite: false })
    expect(combo('Minimum rating')).toBeDisabled()
    expect(within(document.body).getByText('Minimum rating')).toBeInTheDocument()
  })
})
