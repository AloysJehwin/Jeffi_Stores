import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange, placeholder }: any) => (
    <select aria-label={`select:${options[0]?.label ?? placeholder}`} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder ?? '—'}</option>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))

import BaseUnitForm, { BaseUnitRow, type BaseUnitFormProps, type ProductUnit } from '@/components/admin/BaseUnitForm'
import { DIMENSION_LABEL } from '@/lib/catalog/units'

const unit = (over: Partial<ProductUnit> = {}): ProductUnit => ({
  id: 'u1',
  product_id: 'p1',
  variant_id: null,
  unit: 'box',
  factor: 12,
  dimension: 'count',
  conversion_meta: null,
  is_base: true,
  display_label: null,
  notes: null,
  min_qty: 1,
  max_qty: null,
  qty_step: 1,
  ...over,
})

const rowProps = { isVariantScope: false, isSubVariantScope: false, inherited: false, saving: false, onEdit: vi.fn(), onReset: vi.fn() }

describe('BaseUnitRow', () => {
  it('shows unit, dimension, factor and BASE badge for a count unit', () => {
    render(<BaseUnitRow {...rowProps} unit={unit()} />)
    expect(screen.getByText('box')).toBeInTheDocument()
    expect(screen.getByText(DIMENSION_LABEL.count)).toBeInTheDocument()
    expect(screen.getByText('12 pc')).toBeInTheDocument()
    expect(screen.getByText('BASE')).toBeInTheDocument()
  })

  it('hides the factor for a count unit of 1', () => {
    render(<BaseUnitRow {...rowProps} unit={unit({ factor: 1, unit: 'pc' })} />)
    expect(screen.queryByText(/Factor:/)).toBeNull()
  })

  it('shows the SI factor with the right symbol per dimension', () => {
    const { rerender } = render(<BaseUnitRow {...rowProps} unit={unit({ dimension: 'weight', factor: 0.5, unit: 'g' })} />)
    expect(screen.getByText('0.5 kg')).toBeInTheDocument()
    rerender(<BaseUnitRow {...rowProps} unit={unit({ dimension: 'area', factor: 2, unit: 'sqft' })} />)
    expect(screen.getByText('2 m²')).toBeInTheDocument()
    rerender(<BaseUnitRow {...rowProps} unit={unit({ dimension: 'volume', factor: 3, unit: 'cup' })} />)
    expect(screen.getByText('3 L')).toBeInTheDocument()
    rerender(<BaseUnitRow {...rowProps} unit={unit({ dimension: 'length', factor: 4, unit: 'ft' })} />)
    expect(screen.getByText('4 m')).toBeInTheDocument()
  })

  it('describes a custom unit size from its measurements', () => {
    const meta = (extra: object) => ({ custom_unit: true, length: 3, dim_unit: 'm', ...extra })
    const { rerender } = render(<BaseUnitRow {...rowProps} unit={unit({ dimension: 'length', factor: 3, conversion_meta: meta({}) })} />)
    expect(screen.getByText('3 m = 3 m')).toBeInTheDocument()
    rerender(<BaseUnitRow {...rowProps} unit={unit({ dimension: 'area', factor: 6, conversion_meta: meta({ width: 2 }) })} />)
    expect(screen.getByText('3 × 2 m = 6 m²')).toBeInTheDocument()
    rerender(<BaseUnitRow {...rowProps} unit={unit({ dimension: 'volume', factor: 6, conversion_meta: meta({ width: 2, height: 1 }) })} />)
    expect(screen.getByText('3 × 2 × 1 m = 6 L')).toBeInTheDocument()
    expect(screen.queryByText(/SI factor/)).toBeNull()
  })

  it('shows the label and the per-unit price only when valid', () => {
    const { rerender } = render(<BaseUnitRow {...rowProps} unit={unit({ display_label: 'Box of 12' })} basePrice="1200" />)
    expect(screen.getByText('Box of 12')).toBeInTheDocument()
    expect(screen.getByText(/₹1,200\.00 \/ box/)).toBeInTheDocument()
    expect(screen.getByTitle('Product selling price (incl. GST) per BASE unit')).toBeInTheDocument()
    rerender(<BaseUnitRow {...rowProps} isVariantScope unit={unit()} basePrice="1200" />)
    expect(screen.getByTitle('Variant selling price (incl. GST) per BASE unit')).toBeInTheDocument()
    for (const bad of [null, '', 0, 'abc']) {
      rerender(<BaseUnitRow {...rowProps} unit={unit()} basePrice={bad as any} />)
      expect(screen.queryByText(/Price \(incl\. GST\)/)).toBeNull()
    }
  })

  it('Edit calls onEdit; an inherited unit offers Override instead', () => {
    const onEdit = vi.fn()
    const { rerender } = render(<BaseUnitRow {...rowProps} onEdit={onEdit} unit={unit()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onEdit).toHaveBeenCalled()
    rerender(<BaseUnitRow {...rowProps} onEdit={onEdit} inherited unit={unit()} />)
    expect(screen.getByRole('button', { name: 'Override' })).toBeInTheDocument()
  })

  it('offers a reset at variant scope and sub-variant scope, but not when inherited or at product scope', () => {
    const onReset = vi.fn()
    const { rerender } = render(<BaseUnitRow {...rowProps} onReset={onReset} isVariantScope unit={unit()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to product default' }))
    expect(onReset).toHaveBeenCalled()
    rerender(<BaseUnitRow {...rowProps} onReset={onReset} isSubVariantScope unit={unit()} />)
    expect(screen.getByRole('button', { name: 'Reset to variant default' })).toBeInTheDocument()
    rerender(<BaseUnitRow {...rowProps} isVariantScope inherited unit={unit()} />)
    expect(screen.queryByRole('button', { name: /Reset to/ })).toBeNull()
    rerender(<BaseUnitRow {...rowProps} unit={unit()} />)
    expect(screen.queryByRole('button', { name: /Reset to/ })).toBeNull()
  })

  it('disables the reset while saving', () => {
    render(<BaseUnitRow {...rowProps} saving isVariantScope unit={unit()} />)
    expect(screen.getByRole('button', { name: 'Reset to product default' })).toBeDisabled()
  })
})

function formProps(over: Partial<BaseUnitFormProps> = {}): BaseUnitFormProps {
  return {
    draftUnit: 'box',
    setDraftUnit: vi.fn(),
    draftDimension: 'count',
    draftLabel: '',
    setDraftLabel: vi.fn(),
    draftFactor: '12',
    setDraftFactor: vi.fn(),
    draftMinQty: '1',
    setDraftMinQty: vi.fn(),
    draftMaxQty: '',
    setDraftMaxQty: vi.fn(),
    draftQtyStep: '1',
    setDraftQtyStep: vi.fn(),
    isCustomUnit: false,
    customDimUnit: 'm',
    setCustomDimUnit: vi.fn(),
    customLength: '',
    setCustomLength: vi.fn(),
    customWidth: '',
    setCustomWidth: vi.fn(),
    customHeight: '',
    setCustomHeight: vi.fn(),
    dimUnits: [{ key: 'box', label: 'Box' }, { key: 'pack', label: 'Pack' }],
    isPredefined: false,
    showFactor: true,
    customMeasureUnits: [{ key: 'm', label: 'Metre' }],
    customPreview: null,
    customPreviewLabel: 'm²',
    baseUnit: null,
    inherited: false,
    handleDimensionChange: vi.fn(),
    handleUnitChange: vi.fn(),
    saving: false,
    onSave: vi.fn(),
    onCancel: vi.fn(),
    inputCls: 'inp',
    lockedCls: 'locked',
    ...over,
  }
}

describe('BaseUnitForm', () => {
  it('says Set unit for a new unit and Edit unit when overriding an own unit', () => {
    const { rerender } = render(<BaseUnitForm {...formProps()} />)
    expect(screen.getByText('Set unit')).toBeInTheDocument()
    rerender(<BaseUnitForm {...formProps({ baseUnit: unit() })} />)
    expect(screen.getByText('Edit unit')).toBeInTheDocument()
    rerender(<BaseUnitForm {...formProps({ baseUnit: unit(), inherited: true })} />)
    expect(screen.getByText('Set unit')).toBeInTheDocument()
  })

  it('routes dimension and unit picks to the handlers', () => {
    const p = formProps()
    render(<BaseUnitForm {...p} />)
    fireEvent.change(screen.getByLabelText(`select:${DIMENSION_LABEL.count}`), { target: { value: 'weight' } })
    expect(p.handleDimensionChange).toHaveBeenCalledWith('weight')
    fireEvent.change(screen.getByLabelText('select:Box'), { target: { value: '__custom' } })
    expect(p.handleUnitChange).toHaveBeenCalledWith('__custom')
  })

  it('edits factor, label and quantity limits', () => {
    const p = formProps({ draftDimension: 'weight' })
    render(<BaseUnitForm {...p} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. 12'), { target: { value: '24' } })
    expect(p.setDraftFactor).toHaveBeenCalledWith('24')
    fireEvent.change(screen.getByPlaceholderText('e.g. Box of 12'), { target: { value: 'Case' } })
    expect(p.setDraftLabel).toHaveBeenCalledWith('Case')
    fireEvent.change(screen.getByPlaceholderText('1'), { target: { value: '2' } })
    expect(p.setDraftMinQty).toHaveBeenCalledWith('2')
    fireEvent.change(screen.getByPlaceholderText('e.g. 200'), { target: { value: '50' } })
    expect(p.setDraftMaxQty).toHaveBeenCalledWith('50')
    fireEvent.change(screen.getByPlaceholderText('e.g. 0.25'), { target: { value: '0.5' } })
    expect(p.setDraftQtyStep).toHaveBeenCalledWith('0.5')
  })

  it('locks the qty step to 1 for counts but not for other dimensions', () => {
    const { rerender } = render(<BaseUnitForm {...formProps()} />)
    expect(screen.getByText('Qty step (locked to 1)')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('e.g. 0.25')).toBeNull()
    rerender(<BaseUnitForm {...formProps({ draftDimension: 'length' })} />)
    expect(screen.getByText('Qty step *')).toBeInTheDocument()
  })

  it('shows a locked factor for predefined units and hides it when not applicable', () => {
    const { rerender } = render(<BaseUnitForm {...formProps({ isPredefined: true })} />)
    expect(screen.getByText('Units per pc (locked)')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('e.g. 12')).toBeNull()
    rerender(<BaseUnitForm {...formProps({ showFactor: false })} />)
    expect(screen.queryByText(/Units per pc/)).toBeNull()
  })

  it('custom units show a free-text name with a way back to the list', () => {
    const p = formProps({ isCustomUnit: true, draftUnit: '' })
    render(<BaseUnitForm {...p} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. roll, pallet'), { target: { value: 'roll' } })
    expect(p.setDraftUnit).toHaveBeenCalledWith('roll')
    fireEvent.click(screen.getByTitle('Pick from list'))
    expect(p.handleUnitChange).toHaveBeenCalledWith('')
  })

  it('custom measurement inputs follow the dimension', () => {
    const p = formProps({ isCustomUnit: true, draftDimension: 'volume' })
    render(<BaseUnitForm {...p} />)
    expect(screen.getByText('Length *')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('e.g. 3'), { target: { value: '3' } })
    expect(p.setCustomLength).toHaveBeenCalledWith('3')
    fireEvent.change(screen.getByPlaceholderText('e.g. 2'), { target: { value: '2' } })
    expect(p.setCustomWidth).toHaveBeenCalledWith('2')
    fireEvent.change(screen.getByPlaceholderText('e.g. 1'), { target: { value: '1' } })
    expect(p.setCustomHeight).toHaveBeenCalledWith('1')
  })

  it('weight custom units ask for a weight and no width or height; counts have no measurements', () => {
    const { rerender } = render(<BaseUnitForm {...formProps({ isCustomUnit: true, draftDimension: 'weight' })} />)
    expect(screen.getByText('Weight *')).toBeInTheDocument()
    expect(screen.queryByText('Width *')).toBeNull()
    rerender(<BaseUnitForm {...formProps({ isCustomUnit: true, draftDimension: 'count' })} />)
    expect(screen.queryByText('Measurements')).toBeNull()
  })

  it('shows the conversion preview when there is one', () => {
    render(
      <BaseUnitForm {...formProps({ isCustomUnit: true, draftUnit: 'roll', draftDimension: 'area', customPreview: { factor: 6.5, meta: {} }, customPreviewLabel: 'm²' })} />
    )
    expect(screen.getByText(/1 roll = 6\.5 m²/)).toBeInTheDocument()
  })

  it('Save and Cancel call back; Save disables while saving', () => {
    const p = formProps()
    const { rerender } = render(<BaseUnitForm {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(p.onSave).toHaveBeenCalled()
    expect(p.onCancel).toHaveBeenCalled()
    rerender(<BaseUnitForm {...formProps({ saving: true })} />)
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  })
})
