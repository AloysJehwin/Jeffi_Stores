import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

const refresh = vi.fn<(...a: any[]) => any>()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))

import KycActionButtons from '@controller/components/admin/ecom/tabs/KycActionButtons'

const view = (props: Partial<React.ComponentProps<typeof KycActionButtons>> = {}) =>
  render(
    <ToastProvider>
      <KycActionButtons tenantId="t1" {...props} />
    </ToastProvider>,
  )
const mockFetch = (status: number, body: any) => {
  const f = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: status < 400, status, json: async () => body })
  vi.stubGlobal('fetch', f)
  return f
}

describe('KycActionButtons (pending)', () => {
  it('shows the payment choice, Reject and Approve for a store', () => {
    view()
    expect(screen.getByRole('group', { name: 'Payment' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mandatory' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Reject/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument()
  })

  it('omits the payment choice for an API workspace', () => {
    view({ store: false })
    expect(screen.queryByRole('group', { name: 'Payment' })).toBeNull()
  })

  it('approves with payment mandatory and reports the payment link', async () => {
    const f = mockFetch(200, { ok: true, checkoutUrl: 'https://rzp.io/x' })
    view()
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }))
    expect(await screen.findByText('Approved: payment link sent to owner.')).toBeInTheDocument()
    expect(f.mock.calls[0][0]).toBe('/api/admin/ecom/kyc/t1/approve')
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ paymentRequired: true })
    expect(refresh).toHaveBeenCalled()
  })

  it('approves with payment optional when switched', async () => {
    const f = mockFetch(200, { ok: true })
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Optional' }))
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }))
    expect(await screen.findByText('Approved with payment optional: store setup started.')).toBeInTheDocument()
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ paymentRequired: false })
  })

  it('opens the reject box, needs a note, then posts the rejection', async () => {
    const f = mockFetch(200, { ok: true })
    view()
    fireEvent.click(screen.getByRole('button', { name: /Reject/ }))
    const confirmBtn = screen.getByRole('button', { name: /Confirm reject/ })
    expect(confirmBtn).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText(/Reason for rejection/), { target: { value: 'PAN mismatch' } })
    fireEvent.click(confirmBtn)
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(f.mock.calls[0][0]).toBe('/api/admin/ecom/kyc/t1/reject')
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ note: 'PAN mismatch' })
  })

  it('cancels the reject box back to the buttons', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: /Reject/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument()
  })

  it('shows the KYB gate on a 409, lets the admin keep it in review or approve anyway', async () => {
    const f = vi
      .fn<(...a: any[]) => any>()
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ canForce: true, error: 'Incomplete', missing: { store: [{ item: 'pan', label: 'PAN card' }] } }) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ canForce: true, error: 'Incomplete', missing: { store: [{ item: 'pan', label: 'PAN card' }] } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', f)
    view()
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('PAN card')
    fireEvent.click(screen.getByRole('button', { name: 'Keep in review' }))
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Approve anyway' }))
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('toasts a failed approval', async () => {
    mockFetch(500, { ok: false, error: 'Razorpay unavailable' })
    view()
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }))
    expect(await screen.findByText('Razorpay unavailable')).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('KycActionButtons (retry)', () => {
  it('offers Resend payment link while payment is mandatory', async () => {
    const f = mockFetch(200, { ok: true, checkoutUrl: 'https://rzp.io/x' })
    view({ mode: 'retry' })
    fireEvent.click(screen.getByRole('button', { name: /Resend payment link/ }))
    expect(await screen.findByText('Payment link generated; the owner can pay now.')).toBeInTheDocument()
    expect(JSON.parse(f.mock.calls[0][1].body).paymentRequired).toBe(true)
  })

  it('switches to Start build when payment becomes optional', async () => {
    mockFetch(200, { ok: true })
    view({ mode: 'retry' })
    fireEvent.click(screen.getByRole('button', { name: 'Optional' }))
    fireEvent.click(screen.getByRole('button', { name: /Start build/ }))
    expect(await screen.findByText('Build started; payment is optional for this store.')).toBeInTheDocument()
  })
})
