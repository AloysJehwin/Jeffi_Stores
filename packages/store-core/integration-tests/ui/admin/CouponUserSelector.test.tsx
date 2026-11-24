import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CouponUserSelector from '@/components/admin/CouponUserSelector'

const alice = { id: 'u1', full_name: 'Alice Rao', email: 'alice@shop.test' }
const bob = { id: 'u2', full_name: ' ', email: 'bob@shop.test' }

const J = (body: unknown, ok = true) => ({ ok, json: async () => body })

function hidden(container: HTMLElement) {
  return [...container.querySelectorAll('input[type="hidden"]')].map(i => (i as HTMLInputElement).value)
}

describe('CouponUserSelector', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    fetchMock = vi.fn<(...a: any[]) => any>().mockImplementation(async (url: string) => {
      if (url.includes('/customers/search')) return J({ results: [alice, bob] })
      return J({ users: [alice, bob] })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('starts empty in search mode', () => {
    render(<CouponUserSelector />)
    expect(screen.getByPlaceholderText(/Search by name, email or phone/)).toBeInTheDocument()
    expect(screen.queryByText(/selected/)).toBeNull()
  })

  it('searches by text and adds a user as a chip with a hidden input', async () => {
    const { container } = render(<CouponUserSelector name="ids" />)
    fireEvent.change(screen.getByPlaceholderText(/Search by name/), { target: { value: 'ali' } })
    fireEvent.click(await screen.findByText('Alice Rao'))
    expect(hidden(container)).toEqual(['u1'])
    expect(container.querySelector('input[name="ids"]')).not.toBeNull()
    expect(screen.getByText('1 user selected')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/customers/search?q=ali')
  })

  it('falls back to the email when the name is blank', async () => {
    render(<CouponUserSelector />)
    fireEvent.change(screen.getByPlaceholderText(/Search by name/), { target: { value: 'bo' } })
    fireEvent.click(await screen.findByText('bob@shop.test'))
    expect(screen.getAllByText('bob@shop.test').length).toBeGreaterThan(0)
  })

  it('does not search for fewer than two characters', async () => {
    render(<CouponUserSelector />)
    fireEvent.change(screen.getByPlaceholderText(/Search by name/), { target: { value: 'a' } })
    await new Promise(r => setTimeout(r, 400))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('removes a chip and clears all', async () => {
    const { container } = render(<CouponUserSelector />)
    fireEvent.click(screen.getByRole('button', { name: 'All Users' }))
    await screen.findByText('Added 2 users from all users')
    expect(hidden(container)).toEqual(['u1', 'u2'])
    fireEvent.click(screen.getAllByRole('button', { name: '×' })[0])
    expect(hidden(container)).toEqual(['u2'])
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(hidden(container)).toEqual([])
  })

  it('adds a segment through the user pool endpoint', async () => {
    render(<CouponUserSelector />)
    fireEvent.click(screen.getByRole('button', { name: 'By Segment' }))
    fireEvent.click(screen.getByRole('button', { name: 'VIP' }))
    expect(await screen.findByText('Added 2 users from VIP segment')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/coupons/user-pool?mode=segment&segment=vip')
  })

  it('adds a score range', async () => {
    render(<CouponUserSelector />)
    fireEvent.click(screen.getByRole('button', { name: 'By Score' }))
    fireEvent.click(screen.getByRole('button', { name: '80–100' }))
    await screen.findByText(/Added 2 users from score 80–100/)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/coupons/user-pool?mode=score&score_min=80&score_max=100')
  })

  it('reports when there is nothing new to add', async () => {
    fetchMock.mockResolvedValue(J({ users: [alice] }))
    render(<CouponUserSelector />)
    fireEvent.click(screen.getByRole('button', { name: 'All Users' }))
    await screen.findByText('Added 1 user from all users')
    fireEvent.click(screen.getByRole('button', { name: 'All Users' }))
    expect(await screen.findByText('No new users to add from all users')).toBeInTheDocument()
  })

  it('shows the API error', async () => {
    fetchMock.mockResolvedValue(J({ error: 'Forbidden' }, false))
    render(<CouponUserSelector />)
    fireEvent.click(screen.getByRole('button', { name: 'All Users' }))
    await waitFor(() => expect(screen.getByText('Error: Forbidden')).toBeInTheDocument())
  })
})
