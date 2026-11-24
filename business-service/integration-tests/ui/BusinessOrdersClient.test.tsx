import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import BusinessOrdersClient from '@business/app/(business)/business/orders/BusinessOrdersClient'

describe('BusinessOrdersClient', () => {
  it('shows the orders heading and the empty-state message', () => {
    render(<BusinessOrdersClient />)
    expect(screen.getByRole('heading', { name: 'My Orders' })).toBeInTheDocument()
    expect(screen.getByText('Your orders will appear here once you place one.')).toBeInTheDocument()
  })
})
