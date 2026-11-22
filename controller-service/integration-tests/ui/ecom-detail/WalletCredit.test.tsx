import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn<(...a: any[]) => any>() }) }))

import WalletCredit from '@controller/components/admin/ecom/detail/WalletCredit'

describe('WalletCredit (render + sheet + validation)', () => {
  it('opens the credit sheet from the Add credit button', () => {
    render(<WalletCredit tenantId="t1" />)
    expect(screen.queryByText('Credit the wallet')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Add credit/ }))
    expect(screen.getByText('Credit the wallet')).toBeInTheDocument()
  })

  it('validates a non-positive amount before any request', () => {
    const fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
    render(<WalletCredit tenantId="t1" />)
    fireEvent.click(screen.getByRole('button', { name: /Add credit/ }))
    fireEvent.submit(screen.getByText('Reason').closest('form') as HTMLFormElement)
    expect(screen.getByText(/amount above zero/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires a reason even with an amount', () => {
    const fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
    render(<WalletCredit tenantId="t1" />)
    fireEvent.click(screen.getByRole('button', { name: /Add credit/ }))
    const amount = screen.getByText('Amount (₹)').parentElement?.querySelector('input') as HTMLInputElement
    fireEvent.change(amount, { target: { value: '500' } })
    fireEvent.submit(amount.closest('form') as HTMLFormElement)
    expect(screen.getByText(/Say why/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POSTs amount and note to the wallet endpoint when valid', async () => {
    const fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    render(<WalletCredit tenantId="store7" />)
    fireEvent.click(screen.getByRole('button', { name: /Add credit/ }))
    const form = screen.getByText('Reason').closest('form') as HTMLFormElement
    const amount = screen.getByText('Amount (₹)').parentElement?.querySelector('input') as HTMLInputElement
    const note = screen.getByText('Reason').parentElement?.querySelector('input') as HTMLInputElement
    fireEvent.change(amount, { target: { value: '500' } })
    fireEvent.change(note, { target: { value: 'Goodwill credit' } })
    fireEvent.submit(form)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/ecom/store7/wallet')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ amountInr: 500, note: 'Goodwill credit' })
  })
})
