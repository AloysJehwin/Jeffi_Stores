import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const replace = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }), usePathname: () => '/admin/coupons/c1/edit', useSearchParams: () => sp }))
vi.mock('@admin/app/(admin)/admin/coupons/[id]/edit/CouponUserPicker', () => ({
  default: ({ onAdd }: any) => (
    <button onClick={() => onAdd({ id: 'u9', full_name: 'Zed Quill Smith', email: 'zed@x.test' })}>pick-user</button>
  ),
}))

import CouponEligibleUsersClient from '@admin/app/(admin)/admin/coupons/[id]/edit/CouponEligibleUsersClient'

const users = [
  { id: 'u1', email: 'a@x.test', first_name: 'Asha', last_name: 'Rao', times_used: 3 },
  { id: 'u2', email: 'b@x.test', first_name: null, last_name: null, times_used: 0 },
]
const base = { couponId: 'c1', initialUsers: users, canRemove: true, canAdd: true, allUsersMode: false, page: 1, total: 2 }
const fetchMock = vi.fn()

describe('CouponEligibleUsersClient', () => {
  beforeEach(() => {
    sp = new URLSearchParams()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('lists eligible users with usage state', () => {
    render(asAdmin(<CouponEligibleUsersClient {...base} />))
    expect(screen.getAllByText('Asha Rao').length).toBeGreaterThan(0)
    expect(screen.getAllByText('b@x.test').length).toBeGreaterThan(0)
    expect(screen.getAllByText('3x used').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Not used').length).toBeGreaterThan(0)
  })

  it('shows an empty message when there are no users', () => {
    render(asAdmin(<CouponEligibleUsersClient {...base} initialUsers={[]} total={0} />))
    expect(screen.getAllByText('No users found').length).toBeGreaterThan(0)
  })

  it('removes a user via DELETE and drops the row', async () => {
    render(asAdmin(<CouponEligibleUsersClient {...base} />))
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    await waitFor(() => expect(screen.queryAllByText('Asha Rao')).toHaveLength(0))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/coupons/c1/eligible-users')
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(init.body)).toEqual({ user_id: 'u1' })
  })

  it('keeps the row when the removal fails', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    render(asAdmin(<CouponEligibleUsersClient {...base} />))
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getAllByText('Asha Rao').length).toBeGreaterThan(0)
  })

  it('adds a user through the picker and shows them first', async () => {
    render(asAdmin(<CouponEligibleUsersClient {...base} allUsersMode />))
    fireEvent.click(screen.getByRole('button', { name: 'Restrict to specific users' }))
    expect(screen.getByText(/only they can redeem it/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('pick-user'))
    await waitFor(() => expect(screen.getAllByText('Zed Quill Smith').length).toBeGreaterThan(0))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/coupons/c1/eligible-users')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ user_id: 'u9' })
  })

  it('cancel closes the picker', () => {
    render(asAdmin(<CouponEligibleUsersClient {...base} />))
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Add user' })).toBeInTheDocument()
  })

  it('hides add and remove without coupons write scope or page permission', () => {
    const { unmount } = render(asMember(<CouponEligibleUsersClient {...base} />, ['coupons:read']))
    expect(screen.queryByRole('button', { name: 'Add user' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    unmount()
    render(asAdmin(<CouponEligibleUsersClient {...base} canAdd={false} canRemove={false} />))
    expect(screen.queryByRole('button', { name: 'Add user' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })

  it('paging pushes ?usersPage', () => {
    render(asAdmin(<CouponEligibleUsersClient {...base} total={45} />))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(replace).toHaveBeenCalledWith('/admin/coupons/c1/edit?usersPage=2', { scroll: false })
  })
})
