import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import AddStoreClient from '@controller/app/(ecom)/ecom/dashboard/add-store/AddStoreClient'

const tenant = (over: Record<string, unknown> = {}) => ({ slug: 'acme', store_request: null, razorpay_checkout_url: null, payment_required: true, ...over }) as any

describe('AddStoreClient', () => {
  it('explains the four steps and links to the store application', () => {
    render(<AddStoreClient tenant={tenant()} />)
    expect(screen.getByText('Set up your store')).toBeInTheDocument()
    expect(screen.getByText(/We review your application/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Set up my store/ })).toHaveAttribute('href', '/onboard?mode=add-store')
  })

  it('shows the review state while the application is pending', () => {
    render(<AddStoreClient tenant={tenant({ store_request: 'pending_approval' })} />)
    expect(screen.getByText('Store under review')).toBeInTheDocument()
    expect(screen.getByText(/Messaging and documents keep working meanwhile/)).toBeInTheDocument()
  })

  it('after approval with payment mandatory links to the Razorpay checkout', () => {
    render(<AddStoreClient tenant={tenant({ store_request: 'awaiting_payment', razorpay_checkout_url: 'https://rzp.io/pay' })} />)
    expect(screen.getByText('Approved — complete payment')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Complete payment/ })).toHaveAttribute('href', 'https://rzp.io/pay')
  })

  it('asks the owner to refresh while the payment link is being generated', () => {
    render(<AddStoreClient tenant={tenant({ store_request: 'awaiting_payment' })} />)
    expect(screen.getByText(/payment link is being generated/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Complete payment/ })).toBeNull()
  })

  it('after approval with payment optional goes straight to setup', () => {
    render(<AddStoreClient tenant={tenant({ store_request: 'awaiting_payment', payment_required: false })} />)
    expect(screen.getByText('Approved — setting up your store')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('shows provisioning with the store address, for both payment modes', () => {
    const { unmount } = render(<AddStoreClient tenant={tenant({ store_request: 'provisioning' })} />)
    expect(screen.getByText(/Payment confirmed — we are setting up acme.jeffistores.in/)).toBeInTheDocument()
    unmount()
    render(<AddStoreClient tenant={tenant({ store_request: 'provisioning', payment_required: false })} />)
    expect(screen.getByText(/Approved — we are setting up acme.jeffistores.in/)).toBeInTheDocument()
  })
})
