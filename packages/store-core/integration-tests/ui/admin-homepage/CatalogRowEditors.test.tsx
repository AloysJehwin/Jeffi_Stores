import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import CategoryGridEditor from '@/components/admin/homepage/editors/CategoryGridEditor'
import CategoryShowcaseEditor from '@/components/admin/homepage/editors/CategoryShowcaseEditor'
import BrandCarouselEditor from '@/components/admin/homepage/editors/BrandCarouselEditor'
import { renderEditor, input, commit, choose, combo } from './editor-kit'

// CategoryGrid / CategoryShowcase / BrandCarousel editors share one shape: heading + count + layout + CTA.
// Every edit persists straight away through onChange (optimistic) and onSave (the PATCH body).
const CASES = [
  { name: 'CategoryGridEditor', Editor: CategoryGridEditor, type: 'category_grid', defaultTitle: 'Shop by Category', count: 'How many categories' },
  { name: 'CategoryShowcaseEditor', Editor: CategoryShowcaseEditor, type: 'category_showcase', defaultTitle: 'Top Categories', count: 'How many categories' },
  { name: 'BrandCarouselEditor', Editor: BrandCarouselEditor, type: 'brand_carousel', defaultTitle: 'Shop by Brand', count: 'How many brands' },
] as const

describe.each(CASES)('$name', ({ Editor, type, defaultTitle, count }) => {
  it('shows the live default heading with its restore hint', () => {
    renderEditor(Editor, type)
    expect(input('Heading')).toHaveValue(defaultTitle)
    expect(screen.getAllByText(/Live default/).length).toBeGreaterThan(0)
  })

  it('shows a saved heading without the default hint', () => {
    renderEditor(Editor, type, { title: 'Custom', eyebrow: 'Mine', cta_label: 'Go', cta_url: '/x' })
    expect(input('Heading')).toHaveValue('Custom')
    expect(input('Eyebrow')).toHaveValue('Mine')
    expect(input('Button label')).toHaveValue('Go')
    expect(input('Button link')).toHaveValue('/x')
    expect(screen.queryByText(/Live default/)).toBeNull()
  })

  it('saves an edited heading to the row', () => {
    const { onChange, onSave } = renderEditor(Editor, type)
    commit(input('Heading'), 'Browse all')
    expect(onChange).toHaveBeenCalledWith('sec-1', { title: 'Browse all' })
    expect(onSave).toHaveBeenCalledWith('sec-1', { title: 'Browse all' })
  })

  it('stores a cleared heading as null so the storefront default returns', () => {
    const { onSave } = renderEditor(Editor, type, { title: 'Custom' })
    commit(input('Heading'), '   ')
    expect(onSave).toHaveBeenCalledWith('sec-1', { title: null })
  })

  it('saves the item count into config, merged with existing config', () => {
    const { onSave } = renderEditor(Editor, type, { config: { layout: 'carousel' } })
    commit(input(count), '5')
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { layout: 'carousel', limit: 5 } })
  })

  it('rejects a count below the minimum without saving', () => {
    const { onSave } = renderEditor(Editor, type, { config: { limit: 6 } })
    const el = input(count)
    commit(el, '0')
    expect(onSave).not.toHaveBeenCalled()
    expect(el).toHaveValue(6)
  })

  it('switches the layout to carousel', () => {
    const { onSave } = renderEditor(Editor, type)
    expect(combo('Layout')).toHaveTextContent('Grid')
    choose('Layout', 'Carousel')
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { layout: 'carousel' } })
  })

  it('saves the button link', () => {
    const { onSave } = renderEditor(Editor, type)
    commit(input('Button link'), '/brands')
    expect(onSave).toHaveBeenCalledWith('sec-1', { ctaUrl: '/brands' })
  })

  it('disables every field without write access', () => {
    renderEditor(Editor, type, {}, { canWrite: false })
    expect(input('Heading')).toBeDisabled()
    expect(input(count)).toBeDisabled()
    expect(combo('Layout')).toBeDisabled()
  })
})
