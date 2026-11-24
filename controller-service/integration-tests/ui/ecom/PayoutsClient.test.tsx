import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

import PayoutsClient, { type BankState } from '@controller/app/(ecom)/ecom/dashboard/payouts/PayoutsClient'

const bank = (over: Partial<BankState> = {}): BankState => ({
  last4: '9012', ifsc: 'HDFC0001234', holderName: 'Acme Traders', verifiedName: 'ACME TRADERS', verificationStatus: 'verified', verificationRef: null, hasRouteAccount: true, upiId: null, ...over,
})
const view = (initial: BankState | null, hasStore = true) =>
  render(
    <ToastProvider>
      <PayoutsClient initial={initial} hasStore={hasStore} />
    </ToastProvider>,
  )
const mockFetch = (ok: boolean, body: any) => {
  const f = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok, json: async () => body })
  vi.stubGlobal('fetch', f)
  return f
}
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const fillAccount = () => {
  fill('Account number', '123456789012')
  fill('Re-enter account number', '123456789012')
  fill('IFSC', 'hdfc0001234')
  fill('Account holder name', 'Acme Traders')
}

describe('PayoutsClient', () => {
  it('shows a verified account masked, with the bank-returned name and status', () => {
    view(bank())
    expect(screen.getByText('Settlement account')).toBeInTheDocument()
    expect(screen.getByText('••••9012 · HDFC0001234')).toBeInTheDocument()
    expect(screen.getByText('ACME TRADERS')).toBeInTheDocument()
    expect(screen.getByText('Verified')).toBeInTheDocument()
    expect(screen.getByText('Your payouts settle to this account.')).toBeInTheDocument()
    expect(screen.getByText('Not added')).toBeInTheDocument()
  })

  it('shows the awaiting and rejected states, the latter offering a correction', () => {
    const { unmount } = view(bank({ verificationStatus: 'unverified', verifiedName: null }))
    expect(screen.getByText('Awaiting verification')).toBeInTheDocument()
    expect(screen.getByText('Acme Traders')).toBeInTheDocument()
    unmount()
    view(bank({ verificationStatus: 'failed' }))
    expect(screen.getByText('Rejected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Correct these details' })).toBeInTheDocument()
  })

  it('with no account opens the form with the store reason and a disabled save', () => {
    view(null)
    expect(screen.getByText('Add a settlement account')).toBeInTheDocument()
    expect(screen.getByText(/sales, and any refunds due to you, are paid out to this account/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save and verify' })).toBeDisabled()
  })

  it('without a store explains that the account is needed once they sell', () => {
    view(null, false)
    expect(screen.getByText(/Needed only once you sell/)).toBeInTheDocument()
  })

  it('flags mismatching account numbers and strips non-digits', () => {
    view(null)
    fill('Account number', '12ab3456789')
    expect((screen.getByLabelText('Account number') as HTMLInputElement).value).toBe('123456789')
    fill('Re-enter account number', '1234')
    expect(screen.getByText('The two numbers do not match.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save and verify' })).toBeDisabled()
  })

  it('rejects a malformed UPI ID', () => {
    view(null)
    fillAccount()
    fill('UPI ID (optional)', 'nope')
    expect(screen.getByText('A UPI ID looks like name@bank.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save and verify' })).toBeDisabled()
  })

  it('verifies the account, upper-casing the IFSC, then shows the masked account', async () => {
    const f = mockFetch(true, { status: 'verified', verifiedName: 'ACME TRADERS', pushedToRoute: true })
    view(null)
    fillAccount()
    fireEvent.click(screen.getByRole('button', { name: 'Save and verify' }))
    expect(await screen.findByText('Updated with the payment provider.')).toBeInTheDocument()
    expect(f.mock.calls[0][0]).toBe('/api/ecom/bank/verify')
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ accountNumber: '123456789012', ifsc: 'HDFC0001234', holderName: 'Acme Traders' })
    expect(await screen.findByText('••••9012 · HDFC0001234')).toBeInTheDocument()
  })

  it('says it will be sent to the provider later when the store is not live', async () => {
    mockFetch(true, { status: 'unverified' })
    view(null)
    fillAccount()
    fireEvent.click(screen.getByRole('button', { name: 'Save and verify' }))
    expect(await screen.findByText(/sent to the payment provider when your store goes live/)).toBeInTheDocument()
  })

  it('shows the provider reason when the account is refused', async () => {
    mockFetch(false, { reason: 'IFSC not found' })
    view(null)
    fillAccount()
    fireEvent.click(screen.getByRole('button', { name: 'Save and verify' }))
    expect(await screen.findByText('IFSC not found')).toBeInTheDocument()
    expect(screen.getByText('Add a settlement account')).toBeInTheDocument()
  })

  it('shows a network error', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockRejectedValue(new Error('offline')))
    view(null)
    fillAccount()
    fireEvent.click(screen.getByRole('button', { name: 'Save and verify' }))
    expect(await screen.findByText('Network error — please try again.')).toBeInTheDocument()
  })

  it('Change account opens the form and Cancel returns to the summary', () => {
    view(bank())
    fireEvent.click(screen.getByRole('button', { name: 'Change account' }))
    expect(screen.getByText('Update settlement account')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Settlement account')).toBeInTheDocument()
  })

  it('adds a UPI ID on its own with a PATCH', async () => {
    const f = mockFetch(true, {})
    view(bank())
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.change(screen.getByLabelText('UPI ID'), { target: { value: 'acme@okaxis' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('UPI ID saved.')).toBeInTheDocument()
    expect(f.mock.calls[0][0]).toBe('/api/ecom/bank/upi')
    expect(f.mock.calls[0][1].method).toBe('PATCH')
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ upiId: 'acme@okaxis' })
    expect(await screen.findByText('acme@okaxis')).toBeInTheDocument()
  })

  it('removes the UPI ID when the field is emptied', async () => {
    const f = mockFetch(true, {})
    view(bank({ upiId: 'acme@okaxis' }))
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.change(screen.getByLabelText('UPI ID'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('UPI ID removed.')).toBeInTheDocument()
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ upiId: null })
  })

  it('does not allow saving a malformed UPI ID', () => {
    view(bank())
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.change(screen.getByLabelText('UPI ID'), { target: { value: 'bad' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('shows the API error when the UPI ID cannot be saved', async () => {
    mockFetch(false, { error: 'UPI handle not reachable' })
    view(bank())
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.change(screen.getByLabelText('UPI ID'), { target: { value: 'acme@okaxis' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('UPI handle not reachable')).toBeInTheDocument()
  })
})
