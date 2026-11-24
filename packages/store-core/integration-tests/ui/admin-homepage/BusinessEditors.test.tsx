import { describe, it, expect, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import BusinessAccountEditor from '@/components/admin/homepage/editors/BusinessAccountEditor'
import BusinessCtaEditor from '@/components/admin/homepage/editors/BusinessCtaEditor'
import BusinessOffersEditor from '@/components/admin/homepage/editors/BusinessOffersEditor'
import BusinessQuotesEditor from '@/components/admin/homepage/editors/BusinessQuotesEditor'
import BusinessReorderEditor from '@/components/admin/homepage/editors/BusinessReorderEditor'
import { renderEditor, input, commit, choose, combo, stubProductFetch, makeSection, P1 } from './editor-kit'

// The five business-account homepage section editors. Edits save through onChange + onSave; config edits
// are merged over the existing config.
beforeEach(() => {
  stubProductFetch()
})

describe('BusinessAccountEditor', () => {
  it('ticks all three tiles by default and lists the contact fields', () => {
    renderEditor(BusinessAccountEditor, 'business_account')
    for (const name of ['Recent orders', 'Payments due', 'Open quotes']) {
      expect(screen.getByRole('checkbox', { name })).toBeChecked()
    }
    expect(screen.getByText('Sales contact')).toBeInTheDocument()
    expect(input('Phone')).toHaveAttribute('placeholder', '+91 98765 43210')
  })

  it('saves the remaining tiles, in canonical order, when one is unticked', () => {
    const { onSave } = renderEditor(BusinessAccountEditor, 'business_account')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Payments due' }))
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { tiles: ['orders', 'quotes'] } })
  })

  it('re-adds a tile in canonical order', () => {
    const { onSave } = renderEditor(BusinessAccountEditor, 'business_account', { config: { tiles: ['quotes'] } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Recent orders' }))
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { tiles: ['orders', 'quotes'] } })
  })

  it('saves a contact field merged with the existing contact, and nulls a cleared one', () => {
    const { onSave } = renderEditor(BusinessAccountEditor, 'business_account', {
      config: { contact: { name: 'Asha', phone: '999' } },
    })
    expect(input('Name')).toHaveValue('Asha')
    commit(input('Email'), ' sales@shop.in ')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', {
      config: { contact: { name: 'Asha', phone: '999', email: 'sales@shop.in' } },
    })
    commit(input('Phone'), '')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { contact: { name: 'Asha', phone: null } } })
  })

  it('saves what signed-out visitors see', () => {
    const { onSave } = renderEditor(BusinessAccountEditor, 'business_account')
    expect(combo('Signed-out visitors see')).toHaveTextContent('Nothing')
    choose('Signed-out visitors see', 'sign-in')
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { visitor: 'signin' } })
  })

  it('disables tiles and fields without write access', () => {
    renderEditor(BusinessAccountEditor, 'business_account', {}, { canWrite: false })
    expect(screen.getByRole('checkbox', { name: 'Open quotes' })).toBeDisabled()
    expect(input('Name')).toBeDisabled()
  })
})

describe('BusinessCtaEditor', () => {
  it('shows the live default pitch and button copy', () => {
    renderEditor(BusinessCtaEditor, 'business_cta')
    expect(input('Heading')).toHaveValue('Buying for a business?')
    expect(input('Subtitle').value).toMatch(/Bulk discounts/)
    expect(input('Button label')).toHaveValue('Register Now')
    expect(screen.getByText(/Leave empty to use your business signup page/)).toBeInTheDocument()
  })

  it('saves heading, subtitle, button label and link as row columns', () => {
    const { onSave, onChange } = renderEditor(BusinessCtaEditor, 'business_cta')
    commit(input('Heading'), 'Wholesale?')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { title: 'Wholesale?' })
    commit(input('Subtitle'), 'Net-30 terms')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { subtitle: 'Net-30 terms' })
    commit(input('Button label'), 'Apply')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { ctaLabel: 'Apply' })
    commit(input('Button link'), '/business/signup')
    expect(onChange).toHaveBeenLastCalledWith('sec-1', { cta_url: '/business/signup' })
  })

  it('locks the form without write access', () => {
    renderEditor(BusinessCtaEditor, 'business_cta', {}, { canWrite: false })
    expect(input('Heading')).toBeDisabled()
    expect(input('Subtitle')).toBeDisabled()
  })
})

describe('BusinessOffersEditor', () => {
  it('defaults to automatic products with no picker', () => {
    renderEditor(BusinessOffersEditor, 'business_offers')
    expect(combo('Products')).toHaveTextContent('Automatic')
    expect(screen.getByText(/biggest discount first/)).toBeInTheDocument()
    expect(screen.queryByText('Products to show')).toBeNull()
    expect(input('How many products')).toHaveValue(8)
  })

  it('switching to chosen products saves the source', () => {
    const { onSave } = renderEditor(BusinessOffersEditor, 'business_offers')
    choose('Products', 'Chosen products')
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { source: 'picked' } })
  })

  it('shows the picker and an empty-selection note for picked source, then lists picked products', async () => {
    const { rerender } = renderEditor(BusinessOffersEditor, 'business_offers', { config: { source: 'picked' } })
    expect(screen.getByText('Products to show')).toBeInTheDocument()
    expect(screen.getByText(/Pick at least one product/)).toBeInTheDocument()
    rerender(
      <BusinessOffersEditor
        section={makeSection('business_offers', { config: { source: 'picked', productIds: [P1] } })}
        canWrite
        onChange={() => {}}
        onSave={async () => {}}
      />
    )
    expect(await screen.findByText('Cordless Drill')).toBeInTheDocument()
    expect(screen.queryByText(/Pick at least one product/)).toBeNull()
  })

  it('caps the product count at 24', () => {
    const { onSave } = renderEditor(BusinessOffersEditor, 'business_offers')
    commit(input('How many products'), '60')
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { limit: 24 } })
  })

  it('saves the signed-out visitor view and the layout', () => {
    const { onSave } = renderEditor(BusinessOffersEditor, 'business_offers')
    choose('Signed-out visitors see', 'sign-in')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { visitor: 'signin' } })
    choose('Layout', 'Carousel')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { layout: 'carousel' } })
  })

  it('disables the source select without write access', () => {
    renderEditor(BusinessOffersEditor, 'business_offers', {}, { canWrite: false })
    expect(combo('Products')).toBeDisabled()
  })
})

describe('BusinessQuotesEditor', () => {
  it('shows defaults: three quotes listed and the request-quote button hint', () => {
    renderEditor(BusinessQuotesEditor, 'business_quotes')
    expect(input('Open quotes listed')).toHaveValue(3)
    expect(screen.getByText(/Opens the quote request form/)).toBeInTheDocument()
  })

  it('caps the listed quotes at 10', () => {
    const { onSave } = renderEditor(BusinessQuotesEditor, 'business_quotes')
    commit(input('Open quotes listed'), '25')
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { limit: 10 } })
  })

  it('saves the button label and subtitle', () => {
    const { onSave } = renderEditor(BusinessQuotesEditor, 'business_quotes', { cta_label: 'Ask us' })
    expect(input('Button label')).toHaveValue('Ask us')
    commit(input('Button label'), 'Request a quote')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { ctaLabel: 'Request a quote' })
    commit(input('Subtitle'), 'Get pricing in a day')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { subtitle: 'Get pricing in a day' })
  })

  it('is read-only without write access', () => {
    renderEditor(BusinessQuotesEditor, 'business_quotes', {}, { canWrite: false })
    expect(input('Open quotes listed')).toBeDisabled()
  })
})

describe('BusinessReorderEditor', () => {
  it('shows the count clamped into 4-12', () => {
    renderEditor(BusinessReorderEditor, 'business_reorder', { config: { limit: 2 } })
    expect(input('How many products')).toHaveValue(4)
  })

  it('caps the saved count at 12 and rejects below 4', async () => {
    const { onSave } = renderEditor(BusinessReorderEditor, 'business_reorder')
    commit(input('How many products'), '30')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { limit: 12 } })
    onSave.mockClear()
    commit(input('How many products'), '2')
    await waitFor(() => expect(input('How many products')).toHaveValue(8))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves layout and visitor view; locks without write access', () => {
    const { onSave, unmount } = renderEditor(BusinessReorderEditor, 'business_reorder')
    choose('Layout', 'Carousel')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { layout: 'carousel' } })
    unmount()
    renderEditor(BusinessReorderEditor, 'business_reorder', {}, { canWrite: false })
    expect(combo('Signed-out visitors see')).toBeDisabled()
  })
})
