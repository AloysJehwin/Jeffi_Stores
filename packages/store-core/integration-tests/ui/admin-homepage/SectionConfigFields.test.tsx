import { describe, it, expect } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import SectionConfigFields from '@/components/admin/homepage/SectionConfigFields'
import { SECTION_META } from '@/lib/catalog/homepage-sections'
import { renderEditor, input, commit, choose, combo } from './editor-kit'

// SectionConfigFields: the shared section settings form. It picks the section's own editor by type, adds
// "Position and shape" for listing-page sections or shaped banners, and always ends with Scheduling.
const withAspect = (['category_grid', 'product_row'] as const).find(t => SECTION_META[t].aspect)!

describe('SectionConfigFields', () => {
  it('renders the section type’s own editor', () => {
    renderEditor(SectionConfigFields as any, 'recently_viewed')
    expect(input('Show after this many views')).toHaveValue(2)
    expect(input('Heading')).toHaveValue('Recently viewed')
  })

  it('renders only Scheduling for a type with no editor (hero)', () => {
    renderEditor(SectionConfigFields as any, 'hero')
    expect(screen.getByText('Scheduling')).toBeInTheDocument()
    expect(screen.queryByText('Position and shape')).toBeNull()
  })

  it('saves editor changes straight through onChange / onSave', () => {
    const { onChange, onSave } = renderEditor(SectionConfigFields as any, 'recently_viewed')
    commit(input('Show after this many views'), '5')
    expect(onChange).toHaveBeenCalledWith('sec-1', { config: { minItems: 5 } })
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { minItems: 5 } })
  })

  it('shows the scheduling placeholders and hints, empty by default', () => {
    renderEditor(SectionConfigFields as any, 'recently_viewed')
    expect(screen.getByText('Show immediately')).toBeInTheDocument()
    expect(screen.getByText('Never hide')).toBeInTheDocument()
    expect(screen.getByText('Use this for seasonal or sale sections.')).toBeInTheDocument()
  })

  it('shows a saved schedule and clears it through the date picker', () => {
    const { onChange, onSave } = renderEditor(SectionConfigFields as any, 'recently_viewed', { ends_at: '2099-06-10T10:00:00.000Z' })
    expect(screen.queryByText('Never hide')).toBeNull()
    fireEvent.click(screen.getByText(/Jun 2099/))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onChange).toHaveBeenCalledWith('sec-1', { ends_at: null })
    expect(onSave).toHaveBeenCalledWith('sec-1', { endsAt: null })
  })

  it('locks the scheduling pickers without write access', () => {
    renderEditor(SectionConfigFields as any, 'recently_viewed', {}, { canWrite: false })
    expect(screen.getByText('Show immediately').closest('button')).toBeDisabled()
  })

  it('adds Position and shape with placement fields for a listing-page section', () => {
    const { onSave } = renderEditor(SectionConfigFields as any, 'recently_viewed', { page: 'products' })
    expect(screen.getByText('Position and shape')).toBeInTheDocument()
    commit(input('Show after this many products'), '8')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { placement: { after: 8 } } })
    commit(input('Repeat every'), '12')
    expect(onSave.mock.calls.at(-1)![1].config.placement.every).toBe(12)
  })

  it('explains that the right half of a two-column row follows the left half', () => {
    renderEditor(SectionConfigFields as any, 'recently_viewed', { page: 'products' }, { half: 'right' })
    expect(screen.getByText(/right half of a two-column row/)).toBeInTheDocument()
    expect(screen.queryByText('Show after this many products')).toBeNull()
  })

  it('adds a shape select for a type that declares an aspect', () => {
    const { onSave } = renderEditor(SectionConfigFields as any, withAspect)
    const label = `${SECTION_META[withAspect].aspect} shape`
    expect(screen.getByText('Position and shape')).toBeInTheDocument()
    expect(combo(label)).toHaveTextContent('Default')
    choose(label, '1:1')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { aspect: '1:1' } })
  })
})
