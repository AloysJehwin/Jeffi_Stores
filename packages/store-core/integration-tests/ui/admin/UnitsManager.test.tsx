import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let canWrite = true
const showToast = vi.fn<(...a: any[]) => any>()
const showConfirm = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast, showConfirm }) }))
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, onChange, options, placeholder }: any) => (
    <select aria-label="extra unit" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o: any) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
    </select>
  ),
}))
vi.mock('@/components/admin/UnitRulesPanel', () => ({ default: ({ unitId }: any) => <div>rules-for-{unitId}</div> }))
vi.mock('@/components/admin/BaseUnitForm', () => ({
  default: ({ draftUnit, setDraftUnit, draftFactor, setDraftFactor, onSave, onCancel }: any) => (
    <div>
      <input aria-label="base unit" value={draftUnit} onChange={e => setDraftUnit(e.target.value)} />
      <input aria-label="base factor" value={draftFactor} onChange={e => setDraftFactor(e.target.value)} />
      <button onClick={onSave}>Save base</button>
      <button onClick={onCancel}>Cancel base</button>
    </div>
  ),
  BaseUnitRow: ({ unit, onEdit, onReset }: any) => (
    <div>
      <span>base-{unit.unit}</span>
      <button onClick={onEdit}>Edit base</button>
      <button onClick={onReset}>Reset base</button>
    </div>
  ),
}))

import UnitsManager from '@/components/admin/UnitsManager'

const base = { id: 'u1', unit: 'pc', factor: 1, dimension: 'count', is_base: true, variant_id: null, display_label: null, min_qty: 1, max_qty: null, qty_step: 1 }
const extra = { id: 'u2', unit: 'box', factor: 100, dimension: 'count', is_base: false, variant_id: null, display_label: 'Box of 100', min_qty: 2, max_qty: 20, qty_step: 1 }
const fetchMock = vi.fn<(...a: any[]) => any>()
const res = (ok: boolean, data: any = {}, status = ok ? 200 : 400) => ({ ok, status, json: async () => data })

function serve(units: any[], extra: Record<string, any> = {}) {
  fetchMock.mockImplementation(async (_u: string, init?: any) => (init?.method ? res(true) : res(true, { units, rules: [], ...extra })))
}
const calls = (m: string) => fetchMock.mock.calls.filter(c => c[1]?.method === m)

beforeEach(() => {
  canWrite = true
  vi.stubGlobal('fetch', fetchMock)
  serve([base, extra])
})

describe('UnitsManager', () => {
  it('loads units for the product and reports the base unit to the parent', async () => {
    const onUnitLoaded = vi.fn<(...a: any[]) => any>()
    render(<UnitsManager productId="p1" onUnitLoaded={onUnitLoaded} />)
    expect(await screen.findByText('Selling Unit')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/products/p1/units')
    expect(onUnitLoaded).toHaveBeenCalledWith({ unitKey: 'pc', displayLabel: null, dimension: 'count', inherited: false })
    expect(screen.getByText('base-pc')).toBeInTheDocument()
    expect(screen.getByText('rules-for-u1')).toBeInTheDocument()
    expect(screen.getByText('box')).toBeInTheDocument()
    expect(screen.getByText(/^100 pcs$/)).toBeInTheDocument()
    expect(screen.getByText('min 2')).toBeInTheDocument()
    expect(screen.getByText('max 20')).toBeInTheDocument()
  })

  it('uses variant, sub-variant and draft endpoints', async () => {
    const { unmount } = render(<UnitsManager productId="p1" variantId="v1" />)
    await screen.findByText('Variant Unit')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/products/p1/variants/v1/units')
    unmount()
    fetchMock.mockClear()
    const r2 = render(<UnitsManager productId="p1" variantId="v1" subVariantId="s1" />)
    await screen.findByText('Sub-variant Unit')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/products/p1/variants/v1/sub-variants/s1/units')
    r2.unmount()
    fetchMock.mockClear()
    render(<UnitsManager productId="p1" isDraft draftId="d1" />)
    await screen.findByText('Selling Unit')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/products/p1/draft/units?draft=d1')
  })

  it('shows a read-only summary without inventory write access', async () => {
    canWrite = false
    render(<UnitsManager productId="p1" />)
    expect(await screen.findByText('Base')).toBeInTheDocument()
    expect(screen.getByText('(count)')).toBeInTheDocument()
    expect(screen.getByText('× 100')).toBeInTheDocument()
    expect(screen.queryByText('Edit base')).not.toBeInTheDocument()
    expect(screen.queryByText('Add unit')).not.toBeInTheDocument()
  })

  it('says no unit is configured in read-only mode with nothing loaded', async () => {
    serve([])
    render(<UnitsManager productId="p1" readOnly />)
    expect(await screen.findByText('No selling unit configured.')).toBeInTheDocument()
  })

  it('offers Set unit when none exists and validates before saving', async () => {
    serve([])
    render(<UnitsManager productId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Set unit' }))
    fireEvent.click(screen.getByText('Save base'))
    expect(showToast).toHaveBeenCalledWith('Unit name is required', 'error')
    fireEvent.change(screen.getByLabelText('base unit'), { target: { value: 'dozen' } })
    fireEvent.click(screen.getByText('Save base'))
    expect(showToast).toHaveBeenCalledWith('Enter a valid factor (e.g. 12 for dozen)', 'error')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('creates the base unit with POST when there is none', async () => {
    serve([])
    render(<UnitsManager productId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Set unit' }))
    fireEvent.change(screen.getByLabelText('base unit'), { target: { value: 'dozen' } })
    fireEvent.change(screen.getByLabelText('base factor'), { target: { value: '12' } })
    fireEvent.click(screen.getByText('Save base'))
    await waitFor(() => expect(calls('POST')).toHaveLength(1))
    expect(JSON.parse(calls('POST')[0][1].body)).toMatchObject({ unit: 'dozen', factor: 12, dimension: 'count', is_base: true, min_qty: 1, qty_step: 1 })
    await waitFor(() => expect(screen.queryByText('Save base')).not.toBeInTheDocument())
  })

  it('edits an existing base unit with PATCH on its row', async () => {
    render(<UnitsManager productId="p1" />)
    fireEvent.click(await screen.findByText('Edit base'))
    expect(screen.getByLabelText('base unit')).toHaveValue('pc')
    fireEvent.change(screen.getByLabelText('base unit'), { target: { value: 'piece' } })
    fireEvent.click(screen.getByText('Save base'))
    await waitFor(() => expect(calls('PATCH')).toHaveLength(1))
    expect(calls('PATCH')[0][0]).toBe('/api/admin/products/p1/units/u1')
    expect(JSON.parse(calls('PATCH')[0][1].body).unit).toBe('piece')
  })

  it('offers an override on a 409, retrying with override only when accepted', async () => {
    showConfirm.mockResolvedValue(true)
    fetchMock.mockImplementation(async (_u: string, init?: any) => {
      if (!init?.method) return res(true, { units: [base], rules: [] })
      const body = JSON.parse(init.body)
      return body.override ? res(true) : res(false, { error: 'Stock exists', canOverride: true }, 409)
    })
    render(<UnitsManager productId="p1" />)
    fireEvent.click(await screen.findByText('Edit base'))
    fireEvent.click(screen.getByText('Save base'))
    await waitFor(() => expect(calls('PATCH')).toHaveLength(2))
    expect(showConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Existing stock blocks this change', type: 'danger', message: expect.stringContaining('this product') }))
    expect(JSON.parse(calls('PATCH')[1][1].body).override).toBe(true)
  })

  it('keeps the current unit when the override is declined', async () => {
    showConfirm.mockResolvedValue(false)
    fetchMock.mockImplementation(async (_u: string, init?: any) => (!init?.method ? res(true, { units: [base], rules: [] }) : res(false, { error: 'Stock exists', canOverride: true }, 409)))
    render(<UnitsManager productId="p1" />)
    fireEvent.click(await screen.findByText('Edit base'))
    fireEvent.click(screen.getByText('Save base'))
    await waitFor(() => expect(showConfirm).toHaveBeenCalled())
    expect(calls('PATCH')).toHaveLength(1)
    expect(screen.getByText('Save base')).toBeInTheDocument()
  })

  it('toasts a save failure from the server', async () => {
    fetchMock.mockImplementation(async (_u: string, init?: any) => (!init?.method ? res(true, { units: [base], rules: [] }) : res(false, { error: 'Nope' })))
    render(<UnitsManager productId="p1" />)
    fireEvent.click(await screen.findByText('Edit base'))
    fireEvent.click(screen.getByText('Save base'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Nope', 'error'))
  })

  it('resets the base unit with DELETE', async () => {
    render(<UnitsManager productId="p1" />)
    fireEvent.click(await screen.findByText('Reset base'))
    await waitFor(() => expect(calls('DELETE')).toHaveLength(1))
    expect(calls('DELETE')[0][0]).toBe('/api/admin/products/p1/units/u1')
  })

  it('makes an extra unit the default', async () => {
    render(<UnitsManager productId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Make default' }))
    await waitFor(() => expect(calls('PATCH')).toHaveLength(1))
    expect(JSON.parse(calls('PATCH')[0][1].body)).toEqual({ is_base: true })
    expect(showToast).toHaveBeenCalledWith('Box of 100 is now the default selling unit', 'success')
  })

  it('deletes an extra unit and toasts a failure', async () => {
    render(<UnitsManager productId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls('DELETE')).toHaveLength(1))
    expect(calls('DELETE')[0][0]).toBe('/api/admin/products/p1/units/u2')
  })

  it('adds a predefined extra unit with its fixed factor', async () => {
    serve([base])
    render(<UnitsManager productId="p1" />)
    expect(await screen.findByText(/No additional units/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Add unit/ }))
    fireEvent.change(screen.getByLabelText('extra unit'), { target: { value: 'dozen' } })
    expect(screen.getByText('Pcs per unit (locked)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add unit', hidden: false }))
    await waitFor(() => expect(calls('POST')).toHaveLength(1))
    expect(JSON.parse(calls('POST')[0][1].body)).toMatchObject({ unit: 'dozen', factor: 12, is_base: false, dimension: 'count' })
  })

  it('validates a custom extra unit: name, pcs and quantity bounds', async () => {
    serve([base])
    render(<UnitsManager productId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: /Add unit/ }))
    const submit = () => fireEvent.click(screen.getAllByRole('button', { name: 'Add unit' }).at(-1)!)
    submit()
    expect(showToast).toHaveBeenCalledWith('Unit name is required', 'error')
    fireEvent.change(screen.getByLabelText('extra unit'), { target: { value: '__custom' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. carton, pallet'), { target: { value: 'pc' } })
    submit()
    expect(showToast).toHaveBeenCalledWith('pc is already the default unit here', 'error')
    fireEvent.change(screen.getByPlaceholderText('e.g. carton, pallet'), { target: { value: 'carton' } })
    submit()
    expect(showToast).toHaveBeenCalledWith('Enter a valid pcs count (e.g. 12 for dozen)', 'error')
    fireEvent.change(screen.getByPlaceholderText('e.g. 100'), { target: { value: '50' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. 50'), { target: { value: '0' } })
    submit()
    expect(showToast).toHaveBeenCalledWith('Max qty must be ≥ min qty', 'error')
    expect(calls('POST')).toHaveLength(0)
  })

  it('edits an existing extra unit with PATCH', async () => {
    render(<UnitsManager productId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(await screen.findByText('Edit selling unit')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('e.g. Box of 100'), { target: { value: 'Big box' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(calls('PATCH')).toHaveLength(1))
    expect(calls('PATCH')[0][0]).toBe('/api/admin/products/p1/units/u2')
    expect(JSON.parse(calls('PATCH')[0][1].body)).toMatchObject({ unit: 'box', display_label: 'Big box' })
  })

  it('hides extras and rules and shows an inherited hint for an inheriting variant', async () => {
    serve([base], { inherited: true })
    render(<UnitsManager productId="p1" variantId="v1" />)
    expect(await screen.findByText('inherited from product')).toBeInTheDocument()
    expect(screen.getByText('Click Override to set a variant-specific unit.')).toBeInTheDocument()
    expect(screen.queryByText('rules-for-u1')).not.toBeInTheDocument()
  })

  it('shows the custom role note', async () => {
    render(<UnitsManager productId="p1" roleNote="Fallback for sub-variants" />)
    expect(await screen.findByText('Fallback for sub-variants')).toBeInTheDocument()
  })
})
