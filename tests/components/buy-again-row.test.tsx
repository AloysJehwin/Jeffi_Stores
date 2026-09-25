import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

vi.mock('@/components/visitor/ProductCard', () => ({
  default: ({ name }: { name: string }) => <div data-testid="card">{name}</div>,
}))
vi.mock('@/components/visitor/SectionCarousel', () => ({
  default: ({ children, ariaLabel }: { children: React.ReactNode; ariaLabel: string }) => (
    <div role="region" aria-label={ariaLabel}>{children}</div>
  ),
}))

import BuyAgainRow from '@/components/visitor/account/BuyAgainRow'

afterEach(cleanup)

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
}

describe('BuyAgainRow', () => {
  it('renders a card per previously ordered product', async () => {
    const fetchSpy = mockFetch(200, { products: [{ id: 'p1', name: 'Hex bolt' }, { id: 'p2', name: 'Spanner' }] })

    render(<BuyAgainRow />)

    await waitFor(() => expect(screen.getAllByTestId('card')).toHaveLength(2))
    expect(screen.getByRole('region', { name: 'Buy again' })).toBeTruthy()
    expect(screen.getByText('Spanner')).toBeTruthy()
    expect(fetchSpy).toHaveBeenCalledWith('/api/account/buy-again', { credentials: 'include' })
  })

  it('stays hidden when there is nothing to buy again', async () => {
    const fetchSpy = mockFetch(200, { products: [] })
    const { container } = render(<BuyAgainRow />)
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('stays hidden when the request fails', async () => {
    const fetchSpy = mockFetch(401, { error: 'Unauthorized' })
    const { container } = render(<BuyAgainRow />)
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })
})
