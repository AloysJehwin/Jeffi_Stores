import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let canWrite = true
const showToast = vi.fn<(...a: any[]) => any>()
const confirmFn = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirmFn }))
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import UnitRulesPanel from '@/components/admin/UnitRulesPanel'

const rule = (o: Record<string, any> = {}) => ({
  id: 'r1', product_unit_id: 'u1', rule_type: 'tiered_price', is_active: true, priority: 0,
  config: { tiers: [{ min_qty: 10, price: 90 }, { min_qty: 50, price: 80.5 }] }, ...o,
})
const fetchMock = vi.fn<(...a: any[]) => any>()
const onChanged = vi.fn<(...a: any[]) => any>()
const res = (ok: boolean, data: any = {}) => ({ ok, json: async () => data })

function setup(rules: any[] = [rule()], unitVariantId: string | null = null) {
  render(<UnitRulesPanel productId="p1" unitId="u1" unitVariantId={unitVariantId} rules={rules as any} unitLabel="kg" onChanged={onChanged} />)
  fireEvent.click(screen.getByText(/Tiered Pricing/))
}

beforeEach(() => {
  canWrite = true
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(res(true))
})

describe('UnitRulesPanel', () => {
  it('summarises tier count while collapsed and ignores non-tiered rules', () => {
    render(<UnitRulesPanel productId="p1" unitId="u1" unitVariantId={null} rules={[rule(), rule({ id: 'x', rule_type: 'other' })] as any} unitLabel="kg" onChanged={onChanged} />)
    expect(screen.getByText('1 tier')).toBeInTheDocument()
    expect(screen.queryByText('Min qty')).not.toBeInTheDocument()
  })

  it('shows the flat-price empty state', () => {
    setup([])
    expect(screen.getByText('no tiers — flat price')).toBeInTheDocument()
    expect(screen.getByText(/No bulk discount tiers/)).toBeInTheDocument()
  })

  it('lists tier thresholds with unit label and INR prices', () => {
    setup()
    expect(screen.getByText(/≥10 kg: ₹90\.00/)).toBeInTheDocument()
    expect(screen.getByText(/≥50 kg: ₹80\.50/)).toBeInTheDocument()
    expect(screen.getByText('p0')).toBeInTheDocument()
  })

  it('validates min qty and price before posting', async () => {
    setup([])
    fireEvent.click(screen.getByRole('button', { name: '+ Add Tier' }))
    expect(showToast).toHaveBeenCalledWith('Min qty must be > 0', 'error')
    fireEvent.change(screen.getByPlaceholderText('e.g. 10 kg'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add Tier' }))
    expect(showToast).toHaveBeenCalledWith('Price must be >= 0', 'error')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('adds a tier on the product-level endpoint, clears the form and notifies', async () => {
    setup([])
    fireEvent.change(screen.getByPlaceholderText('e.g. 10 kg'), { target: { value: '20' } })
    fireEvent.change(screen.getByPlaceholderText('per kg'), { target: { value: '70' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add Tier' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/products/p1/units/u1/rules')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      rule_type: 'tiered_price', config: { tiers: [{ min_qty: 20, price: 70 }] }, is_active: true, priority: 0,
    })
    expect(screen.getByPlaceholderText('e.g. 10 kg')).toHaveValue(null)
  })

  it('uses the variant endpoint for variant-level units and toasts add errors', async () => {
    fetchMock.mockResolvedValue(res(false, { error: 'Overlapping tier' }))
    setup([], 'v9')
    fireEvent.change(screen.getByPlaceholderText('e.g. 10 kg'), { target: { value: '20' } })
    fireEvent.change(screen.getByPlaceholderText('per kg'), { target: { value: '70' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add Tier' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Overlapping tier', 'error'))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/products/p1/variants/v9/units/u1/rules')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('toggles a rule active flag with PATCH', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'on' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/products/p1/units/u1/rules/r1')
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ is_active: false })
  })

  it('deletes a rule only after confirming', async () => {
    confirmFn.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'delete' }))
    await waitFor(() => expect(confirmFn).toHaveBeenCalledTimes(1))
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'delete' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
  })

  it('toasts a delete failure', async () => {
    confirmFn.mockResolvedValue(true)
    fetchMock.mockResolvedValue(res(false, { error: 'In use' }))
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'delete' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('In use', 'error'))
  })

  it('is read-only without inventory write access', () => {
    canWrite = false
    setup()
    expect(screen.getByText(/≥10 kg/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Add Tier' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'delete' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'on' })).not.toBeInTheDocument()
  })
})
