import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import UpiManualDialog, { isValidUtr } from '@/components/payments/UpiManualDialog'
import type { UpiManualState } from '@/components/payments/useUpiPayment'

// Manual UPI dialog: shows the store's VPA / QR and takes a UTR. UTR gate drives the submit button.
// createPortal targets document.body (happy-dom supports it); no network — onConfirm is a prop.

const manual: UpiManualState = {
  intentId: 'int_1',
  amountPaise: 123400,
  vpa: 'store@upi',
  payeeName: 'Jeffi Store',
  upiUri: 'upi://pay?pa=store@upi&am=1234',
  qrDataUrl: 'data:image/png;base64,QR',
  reference: 'REF-9',
}

describe('isValidUtr', () => {
  it('accepts 12–22 alphanumeric chars and rejects short / spaced values', () => {
    expect(isValidUtr('123456789012')).toBe(true)
    expect(isValidUtr('  ABCD1234EFGH  ')).toBe(true) // trimmed first
    expect(isValidUtr('123')).toBe(false)
    expect(isValidUtr('has space here')).toBe(false)
    expect(isValidUtr('')).toBe(false)
  })
})

describe('UpiManualDialog (render + branches)', () => {
  it('renders nothing when manual is null', () => {
    const { container } = render(<UpiManualDialog manual={null} onConfirm={() => {}} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the payee, VPA, amount and reference when open', () => {
    render(<UpiManualDialog manual={manual} onConfirm={() => {}} onClose={() => {}} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const d = within(dialog)
    expect(d.getByText('Jeffi Store')).toBeInTheDocument()
    expect(d.getByText('store@upi')).toBeInTheDocument()
    expect(d.getByText('REF-9')).toBeInTheDocument()
    // Amount is paise/100 formatted (two places appear: header + amount row).
    expect(d.getAllByText(/₹1,234\.00/).length).toBeGreaterThan(0)
    // QR renders with an accessible alt.
    expect(d.getByAltText('UPI QR code for store@upi')).toBeInTheDocument()
  })

  it('surfaces a server error in an alert region', () => {
    render(<UpiManualDialog manual={manual} error="Could not record the payment" onConfirm={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not record the payment')
  })

  it('shows the invalid-UTR hint and blocks submit on a bad UTR', () => {
    const onConfirm = vi.fn()
    render(<UpiManualDialog manual={manual} onConfirm={onConfirm} onClose={() => {}} />)
    const input = screen.getByLabelText(/UTR \/ transaction reference/) as HTMLInputElement
    fireEvent.change(input, { target: { value: '123' } })
    fireEvent.submit(input.closest('form')!)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText(/Enter the 12-digit UTR/)).toBeInTheDocument()
  })

  it('submits the trimmed, upper-cased UTR when valid', () => {
    const onConfirm = vi.fn()
    render(<UpiManualDialog manual={manual} onConfirm={onConfirm} onClose={() => {}} />)
    const input = screen.getByLabelText(/UTR \/ transaction reference/) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'abcd1234efgh' } })
    fireEvent.submit(input.closest('form')!)
    expect(onConfirm).toHaveBeenCalledWith('ABCD1234EFGH')
  })

  it('strips whitespace from the UTR as it is typed', () => {
    render(<UpiManualDialog manual={manual} onConfirm={() => {}} onClose={() => {}} />)
    const input = screen.getByLabelText(/UTR \/ transaction reference/) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'ab cd 12 34 ef gh' } })
    expect(input.value).toBe('abcd1234efgh')
  })

  it('calls onClose from the Cancel button', () => {
    const onClose = vi.fn()
    render(<UpiManualDialog manual={manual} onConfirm={() => {}} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the busy state and disables Cancel while recording', () => {
    render(<UpiManualDialog manual={manual} busy onConfirm={() => {}} onClose={() => {}} />)
    expect(screen.getByText('Recording…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})
