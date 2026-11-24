import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

let pushFrame: (f: any) => void = () => {}
let pushStatus: (s: string) => void = () => {}
const unsubscribe = vi.fn<(...a: any[]) => any>()
vi.mock('@/lib/client/admin-events-client', () => ({
  subscribeAdminEvents: (h: any, s: any) => {
    pushFrame = h
    pushStatus = s
    return unsubscribe
  },
}))
vi.mock('@/lib/shared/admin-path', () => ({ ap: (p: string) => p }))

import NotificationBell from '@/components/admin/NotificationBell'

const n = (o: Record<string, any> = {}) => ({
  id: 'n1', type: 't', category: 'orders', title: 'New order', message: 'Order #12 placed', link: '/admin/orders/12',
  severity: 'info', is_read: false, created_at: new Date().toISOString(), ...o,
})
const fetchMock = vi.fn<(...a: any[]) => any>()
const feed = (items: any[], unreadCount: number) => ({ ok: true, json: async () => ({ items, unreadCount }) })

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(feed([], 0))
})

describe('NotificationBell', () => {
  it('shows no badge when nothing is unread and an empty panel says caught up', async () => {
    render(<NotificationBell />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/notifications'))
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument()
    expect(screen.queryByText('Mark all read')).not.toBeInTheDocument()
  })

  it('shows the unread badge (capped at 99+) and lists notifications', async () => {
    fetchMock.mockResolvedValue(feed([n(), n({ id: 'n2', title: 'Low stock', message: null, link: null, severity: 'warning', is_read: true })], 120))
    render(<NotificationBell />)
    expect(await screen.findByText('99+')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(screen.getByText('New order')).toBeInTheDocument()
    expect(screen.getByText('Order #12 placed')).toBeInTheDocument()
    expect(screen.getAllByText('just now')).toHaveLength(2)
    expect(screen.getByText('New order').closest('a')).toHaveAttribute('href', '/admin/orders/12')
    expect(screen.getByText('Low stock').closest('button')).not.toBeNull()
  })

  it('marks a notification read optimistically when its row is clicked', async () => {
    fetchMock.mockResolvedValue(feed([n()], 1))
    render(<NotificationBell />)
    await screen.findByText('1')
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    fireEvent.click(screen.getByText('New order'))
    await waitFor(() => expect(screen.queryByText('1')).not.toBeInTheDocument())
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/admin/notifications/read')!
    expect(JSON.parse(post[1].body)).toEqual({ ids: ['n1'] })
    expect(screen.queryByText('Notifications', { selector: 'span' })).not.toBeInTheDocument()
  })

  it('marks everything read', async () => {
    fetchMock.mockResolvedValue(feed([n(), n({ id: 'n2' })], 2))
    render(<NotificationBell />)
    await screen.findByText('2')
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(screen.queryByText('Mark all read')).not.toBeInTheDocument())
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/admin/notifications/read')!
    expect(JSON.parse(post[1].body)).toEqual({ all: true })
  })

  it('applies pushed notification frames and refetches when the stream opens', async () => {
    render(<NotificationBell />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    act(() => pushFrame({ kind: 'notifications', items: [n({ title: 'Live one' })], unreadCount: 3 }))
    expect(await screen.findByText('3')).toBeInTheDocument()
    act(() => pushStatus('open'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('closes on Escape and on outside click', async () => {
    render(<NotificationBell />)
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText("You're all caught up.")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByText("You're all caught up.")).not.toBeInTheDocument()
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<NotificationBell />)
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
