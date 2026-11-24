import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, onChange, options, disabled }: any) => (
    <select data-testid="select" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))

import SubVariantEditor, { emptySubVariantDraft, autoSubVariantSku } from '@/components/admin/SubVariantEditor'

const pkgs = [{ value: 'corrugated_box', label: 'Corrugated box' }, { value: 'flat_poly_auto', label: 'Flat poly' }]

function setup(over: Record<string, any> = {}, draft: Record<string, any> = {}) {
  const onChange = vi.fn<(...a: any[]) => any>()
  const onSubmit = vi.fn<(...a: any[]) => any>()
  const onCancel = vi.fn<(...a: any[]) => any>()
  render(
    <SubVariantEditor
      mode="add" value={{ ...emptySubVariantDraft(), ...draft }} onChange={onChange} onSubmit={onSubmit} onCancel={onCancel}
      parentSku="DRL" discountPct="10" gstRate={18} packageTypes={pkgs} inherited={{}} {...over}
    />
  )
  return { onChange, onSubmit, onCancel }
}

describe('SubVariantEditor helpers', () => {
  it('builds an auto SKU from the parent SKU and name', () => {
    expect(autoSubVariantSku('DRL', 'Red 2-pack')).toBe('DRL-RED2PACK')
    expect(autoSubVariantSku('', 'Red')).toBe('')
  })
})

describe('SubVariantEditor', () => {
  it('disables submit until a name is entered', () => {
    setup()
    expect(screen.getByRole('button', { name: '+ Add Sub-Variant' })).toBeDisabled()
  })

  it('submits when named, and shows Cancel only in edit mode', () => {
    const { onSubmit, onCancel } = setup({ mode: 'edit' }, { name: 'Red' })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(onSubmit).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('has no Cancel button in add mode', () => {
    setup({}, { name: 'Red' })
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('auto-generates the SKU as the name changes while it is still auto', () => {
    const { onChange } = setup()
    fireEvent.change(screen.getByPlaceholderText('e.g. Red'), { target: { value: 'Blue' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'Blue', sku: 'DRL-BLUE' }))
  })

  it('keeps a manually typed SKU when the name changes', () => {
    const { onChange } = setup({}, { name: 'Red', sku: 'CUSTOM-1' })
    expect(screen.getByText('SKU (manual)')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('e.g. Red'), { target: { value: 'Redder' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'Redder', sku: 'CUSTOM-1' }))
  })

  it('derives MRP incl. GST, discounted price ex/incl GST from MRP ex GST', () => {
    const { onChange } = setup({}, { name: 'Red' })
    fireEvent.change(screen.getByPlaceholderText('From catalog'), { target: { value: '100' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mrp_ex_gst: '100', mrp: '118.00', price_ex_gst: '90', price: '106.20' }))
  })

  it('clears derived prices when MRP ex GST is emptied', () => {
    const { onChange } = setup({}, { name: 'Red', mrp_ex_gst: '100', price: '106.20' })
    fireEvent.change(screen.getByPlaceholderText('From catalog'), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mrp_ex_gst: '', mrp: '', price_ex_gst: '', price: '' }))
  })

  it('shows the locked product discount and the unit suffix', () => {
    setup({ unitKey: 'kg' })
    expect(screen.getByTitle('Product-level discount')).toHaveValue(10)
    expect(screen.getAllByText('/ kg').length).toBeGreaterThan(0)
  })

  it('shows dimension fields only for package types that need them, with inherited hints', () => {
    setup({ inherited: { package_type: 'corrugated_box', length_cm: '30' } })
    expect(screen.getByText('Dimensions (L × B × H cm)')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('L (30)')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Inherit (Corrugated box)' })).toBeInTheDocument()
  })

  it('hides dimensions for a flat package and emits shipping edits', () => {
    const { onChange } = setup({ inherited: { weight_grams: '250' } })
    expect(screen.queryByText('Dimensions (L × B × H cm)')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Inherit (250 g)'), { target: { value: '300' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ weight_grams: '300' }))
  })

  it('emits a dimension edit once a box type is chosen', () => {
    const { onChange } = setup({}, { package_type: 'corrugated_box' })
    fireEvent.change(screen.getByPlaceholderText('B'), { target: { value: '12' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ breadth_cm: '12' }))
  })

  it('disables every input when disabled', () => {
    setup({ disabled: true }, { name: 'Red' })
    expect(screen.getByPlaceholderText('e.g. Red')).toBeDisabled()
    expect(screen.getByRole('button', { name: '+ Add Sub-Variant' })).toBeDisabled()
    screen.getAllByTestId('select').forEach(s => expect(s).toBeDisabled())
  })
})
