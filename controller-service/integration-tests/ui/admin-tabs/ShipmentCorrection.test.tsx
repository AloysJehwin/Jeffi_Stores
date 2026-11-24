import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

const refresh = vi.fn<(...a: any[]) => any>()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import ShipmentCorrection from '@controller/components/admin/ecom/tabs/ShipmentCorrection'

const unbilled = { id: 's1', order_number: 'ORD-1', awb_number: 'AWB111', delhivery_billed_amount: null, delhivery_billed_at: null } as any
const billed = { ...unbilled, delhivery_billed_amount: '95', delhivery_billed_at: '2026-11-19T00:00:00Z' }

const view = (shipment: any, onClose = vi.fn<(...a: any[]) => any>()) => {
  render(
    <ToastProvider>
      <ShipmentCorrection tenantId="t1" shipment={shipment} onClose={onClose} />
    </ToastProvider>,
  )
  return onClose
}
const amount = () => screen.getByText('Actual billed (₹)').parentElement!.querySelector('input') as HTMLInputElement
const note = () => screen.getByText('Proof / reference').parentElement!.querySelector('input') as HTMLInputElement

describe('ShipmentCorrection', () => {
  it('renders nothing without a shipment', () => {
    view(null)
    expect(screen.queryByText('Set charge')).toBeNull()
  })

  it('opens as "Set charge" for an unbilled shipment', () => {
    view(unbilled)
    expect(screen.getByText('Set charge')).toBeInTheDocument()
    expect(screen.getByText('Order ORD-1 · AWB AWB111')).toBeInTheDocument()
    expect(amount().value).toBe('')
  })

  it('opens as "Correct charge" prefilled with the billed amount', () => {
    view(billed)
    expect(screen.getByText('Correct charge')).toBeInTheDocument()
    expect(amount().value).toBe('95')
  })

  it('validates the amount and the proof note before any request', () => {
    const fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
    view(unbilled)
    fireEvent.submit(amount().closest('form')!)
    expect(screen.getByText('Enter a valid amount')).toBeInTheDocument()
    fireEvent.change(amount(), { target: { value: '120' } })
    fireEvent.submit(amount().closest('form')!)
    expect(screen.getByText('A proof note is required')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POSTs the corrected charge, then closes and refreshes', async () => {
    const fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const onClose = view(unbilled)
    fireEvent.change(amount(), { target: { value: '120.5' } })
    fireEvent.change(note(), { target: { value: ' INV-77 ' } })
    fireEvent.submit(amount().closest('form')!)
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/ecom/t1/shipments/s1/correct')
    expect(JSON.parse(init.body)).toEqual({ chargedAmount: 120.5, proofNote: 'INV-77' })
    expect(refresh).toHaveBeenCalled()
  })

  it('shows the server error and stays open', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: false, json: async () => ({ error: 'Already settled' }) }))
    const onClose = view(billed)
    fireEvent.change(note(), { target: { value: 'ref' } })
    fireEvent.submit(amount().closest('form')!)
    expect(await screen.findByText('Already settled')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
