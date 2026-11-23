import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PaymentSections, { UpiMark } from '@/components/payments/PaymentSections'

// The payment picker: a UPI section + an "Other payment methods" section (Razorpay / COD / manual).
// Radio semantics; it emits the chosen PaymentChoice via onChange. No network — pure props.

describe('PaymentSections (render + branches)', () => {
  it('renders nothing when no methods are enabled', () => {
    const { container } = render(<PaymentSections value={null} onChange={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the UPI section and the default other-methods when upi + razorpay are on', () => {
    render(<PaymentSections upi razorpay value={null} onChange={() => {}} />)
    // "UPI" appears twice (legend + radio title); the legend is the group label.
    expect(screen.getAllByText('UPI').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Other payment methods')).toBeInTheDocument()
    expect(screen.getByText('Cards, net banking, wallets & EMI')).toBeInTheDocument()
    // Three radios? Only two here: upi + razorpay.
    expect(screen.getAllByRole('radio')).toHaveLength(2)
  })

  it('labels the lone section "Payment methods" when UPI is absent', () => {
    render(<PaymentSections razorpay cod value={null} onChange={() => {}} />)
    expect(screen.getByText('Payment methods')).toBeInTheDocument()
    expect(screen.queryByText('UPI')).not.toBeInTheDocument()
    expect(screen.getByText('Cash on Delivery')).toBeInTheDocument()
  })

  it('hides the UPI section when hideUpi is set even though upi is true', () => {
    render(<PaymentSections upi razorpay hideUpi value={null} onChange={() => {}} />)
    expect(screen.queryByText('UPI')).not.toBeInTheDocument()
    expect(screen.getByText('Payment methods')).toBeInTheDocument()
  })

  it('uses autopay copy in mode="autopay"', () => {
    render(<PaymentSections upi razorpay mode="autopay" value={null} onChange={() => {}} />)
    expect(screen.getByText('UPI Autopay')).toBeInTheDocument()
    expect(screen.getByText('Card')).toBeInTheDocument()
    expect(screen.getByText(/Recurring charge on a credit or debit card/)).toBeInTheDocument()
  })

  it('shows the per-cycle amount in autopay UPI copy when amountInr is given', () => {
    render(<PaymentSections upi mode="autopay" amountInr={499} value={null} onChange={() => {}} />)
    expect(screen.getByText(/₹499\.00 each cycle/)).toBeInTheDocument()
  })

  it('marks the selected radio checked and renders its note', () => {
    render(
      <PaymentSections
        upi={{ note: 'Pay in your UPI app' }}
        razorpay
        value="upi"
        onChange={() => {}}
      />
    )
    const upiRadio = screen.getByRole('radio', { name: /UPI/ }) as HTMLInputElement
    expect(upiRadio.checked).toBe(true)
    // Note only renders for the selected row.
    expect(screen.getByText('Pay in your UPI app')).toBeInTheDocument()
  })

  it('does not render the note of an unselected row', () => {
    render(<PaymentSections upi={{ note: 'hidden note' }} razorpay value="razorpay" onChange={() => {}} />)
    expect(screen.queryByText('hidden note')).not.toBeInTheDocument()
  })

  it('fires onChange with the method key when a radio is clicked', () => {
    const onChange = vi.fn()
    render(<PaymentSections upi razorpay cod value={null} onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: /Cash on Delivery/ }))
    expect(onChange).toHaveBeenCalledWith('cod')
  })

  it('disables a row and keeps it from firing onChange', () => {
    const onChange = vi.fn()
    render(<PaymentSections razorpay={{ disabled: true }} value={null} onChange={onChange} />)
    const radio = screen.getByRole('radio') as HTMLInputElement
    expect(radio.disabled).toBe(true)
    fireEvent.click(radio)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('honours custom row title/description overrides', () => {
    render(
      <PaymentSections
        manual={{ title: 'Call us', description: 'We ring you back' }}
        value={null}
        onChange={() => {}}
      />
    )
    expect(screen.getByText('Call us')).toBeInTheDocument()
    expect(screen.getByText('We ring you back')).toBeInTheDocument()
  })

  it('shares one radio-group name across rows (via the name prop)', () => {
    render(<PaymentSections upi razorpay name="checkout-pay" value={null} onChange={() => {}} />)
    for (const r of screen.getAllByRole('radio')) {
      expect(r).toHaveAttribute('name', 'checkout-pay')
    }
  })
})

describe('UpiMark', () => {
  it('renders an aria-hidden svg carrying the UPI glyph', () => {
    const { container } = render(<UpiMark />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg).toHaveAttribute('aria-hidden')
    expect(screen.getByText('UPI')).toBeInTheDocument()
  })
})
