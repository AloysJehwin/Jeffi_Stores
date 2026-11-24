import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

let pathname = '/admin/dashboard'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

let onFrame: (f: any) => void = () => {}
let onStatus: (s: string) => void = () => {}
const unsubscribe = vi.fn()
const reconnect = vi.fn()
vi.mock('@/lib/client/admin-events-client', () => ({
  subscribeAdminEvents: (frame: any, status: any) => {
    onFrame = frame
    onStatus = status
    return unsubscribe
  },
  reconnectAdminEvents: () => reconnect(),
}))

import AdminSessionController from '@/components/admin/AdminSessionController'

const T0 = new Date('2026-01-01T00:00:00Z').getTime()

type Session = { authenticated: boolean; deadlineAt?: number; expiresAt?: number; serverNow?: number }
let session: Session
let calls: Array<{ url: string; method: string }>
let heartbeatResponse: { status: number; body: any }

function routedFetch() {
  return vi.fn<(...a: any[]) => any>().mockImplementation(async (url: string, init?: any) => {
    calls.push({ url, method: init?.method ?? 'GET' })
    if (url.includes('check-session')) return { ok: true, status: 200, json: async () => ({ ...session, serverNow: Date.now() }) }
    if (url.includes('heartbeat')) return { ok: heartbeatResponse.status < 400, status: heartbeatResponse.status, json: async () => heartbeatResponse.body }
    return { ok: true, status: 200, json: async () => ({}) }
  })
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const hit = (suffix: string) => calls.filter(c => c.url.endsWith(suffix))

describe('AdminSessionController', () => {
  let location: any
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    pathname = '/admin/dashboard'
    calls = []
    session = { authenticated: true, deadlineAt: T0 + 30 * 60_000, expiresAt: T0 + 8 * 3600_000 }
    heartbeatResponse = { status: 200, body: { deadlineAt: T0 + 40 * 60_000, expiresAt: T0 + 8 * 3600_000 } }
    location = { host: 'shop.test', hostname: 'shop.test', href: 'http://shop.test/admin/dashboard', protocol: 'http:', origin: 'http://shop.test', pathname: '/admin/dashboard', search: '', hash: '', assign: vi.fn(), replace: vi.fn(), reload: vi.fn() }
    Object.defineProperty(window, 'location', { value: location, configurable: true, writable: true })
    vi.stubGlobal('fetch', routedFetch())
    vi.stubGlobal('BroadcastChannel', undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing and makes no requests on the login page', async () => {
    pathname = '/admin/login'
    const { container } = render(<AdminSessionController />)
    await flush()
    expect(container.firstChild).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('syncs the deadline from the server on mount and stays quiet when far from expiry', async () => {
    const { container } = render(<AdminSessionController />)
    await flush()
    expect(hit('/api/admin/check-session')).toHaveLength(1)
    expect(container.firstChild).toBeNull()
  })

  it('warns a minute before idle expiry and counts down', async () => {
    session = { authenticated: true, deadlineAt: T0 + 90_000, expiresAt: T0 + 8 * 3600_000 }
    render(<AdminSessionController />)
    await flush()
    expect(screen.queryByText('Still there?')).toBeNull()
    await flush(31_000)
    expect(screen.getByText('Still there?')).toBeInTheDocument()
    expect(screen.getByText('00:59')).toBeInTheDocument()
    await flush(2000)
    expect(screen.getByText('00:57')).toBeInTheDocument()
  })

  it('Continue working sends a heartbeat and dismisses the warning', async () => {
    session = { authenticated: true, deadlineAt: T0 + 30_000, expiresAt: T0 + 8 * 3600_000 }
    render(<AdminSessionController />)
    await flush()
    expect(screen.getByText('Still there?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue working' }))
    await flush()
    expect(hit('/api/admin/session/heartbeat').length).toBeGreaterThan(0)
    expect(hit('/api/admin/session/heartbeat')[0].method).toBe('POST')
    expect(screen.queryByText('Still there?')).toBeNull()
  })

  it('shows the Session Ending variant near the absolute limit and refreshes on continue', async () => {
    const end = T0 + 30_000
    session = { authenticated: true, deadlineAt: end, expiresAt: end }
    render(<AdminSessionController />)
    await flush()
    expect(screen.getByText('Session Ending')).toBeInTheDocument()
    session = { authenticated: true, deadlineAt: T0 + 3600_000, expiresAt: T0 + 9 * 3600_000 }
    fireEvent.click(screen.getByRole('button', { name: 'Continue working' }))
    await flush()
    expect(hit('/api/admin/refresh')[0].method).toBe('POST')
    expect(hit('/api/admin/check-session').length).toBeGreaterThan(1)
    expect(screen.queryByText('Session Ending')).toBeNull()
  })

  it('Log out notifies the server and redirects to the login page', async () => {
    session = { authenticated: true, deadlineAt: T0 + 30_000, expiresAt: T0 + 8 * 3600_000 }
    render(<AdminSessionController />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
    await flush()
    expect(hit('/api/admin/logout')[0].method).toBe('POST')
    expect(location.href).toBe('/admin/login')
  })

  it('redirects to /login on an admin subdomain', async () => {
    location.host = 'admin.shop.test'
    session = { authenticated: true, deadlineAt: T0 + 30_000, expiresAt: T0 + 8 * 3600_000 }
    render(<AdminSessionController />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
    await flush()
    expect(location.href).toBe('/login')
  })

  it('logs out when the server says the session is gone', async () => {
    session = { authenticated: false }
    render(<AdminSessionController />)
    await flush()
    expect(hit('/api/admin/logout')).toHaveLength(1)
    expect(location.href).toBe('/admin/login')
  })

  it('a logout frame on the event stream redirects without calling the server', async () => {
    render(<AdminSessionController />)
    await flush()
    act(() => onFrame({ kind: 'session', type: 'logout', reason: 'revoked' }))
    await flush()
    expect(location.href).toBe('/admin/login')
    expect(hit('/api/admin/logout')).toHaveLength(0)
  })

  it('a deadline frame moves the warning', async () => {
    render(<AdminSessionController />)
    await flush()
    act(() => onFrame({ kind: 'session', type: 'deadline', deadlineAt: Date.now() + 20_000, expiresAt: T0 + 8 * 3600_000, serverNow: Date.now() }))
    await flush()
    expect(screen.getByText('Still there?')).toBeInTheDocument()
    expect(screen.getByText('00:20')).toBeInTheDocument()
  })

  it('resyncs when the event stream errors', async () => {
    render(<AdminSessionController />)
    await flush()
    const before = hit('/api/admin/check-session').length
    await flush(6000)
    act(() => onStatus('error'))
    await flush()
    expect(hit('/api/admin/check-session').length).toBe(before + 1)
  })

  it('at the deadline it asks the server first and stays signed in if another tab extended it', async () => {
    session = { authenticated: true, deadlineAt: T0 + 10_000, expiresAt: T0 + 8 * 3600_000 }
    render(<AdminSessionController />)
    await flush()
    session = { authenticated: true, deadlineAt: T0 + 3600_000, expiresAt: T0 + 8 * 3600_000 }
    await flush(11_000)
    expect(hit('/api/admin/logout')).toHaveLength(0)
    expect(screen.queryByText('Still there?')).toBeNull()
  })

  it('at the deadline it signs out when the server agrees the session is idle', async () => {
    session = { authenticated: true, deadlineAt: T0 + 10_000, expiresAt: T0 + 8 * 3600_000 }
    render(<AdminSessionController />)
    await flush()
    session = { authenticated: true, deadlineAt: T0 + 10_000, expiresAt: T0 + 8 * 3600_000 }
    await flush(11_000)
    expect(hit('/api/admin/logout')).toHaveLength(1)
    expect(location.href).toBe('/admin/login')
  })

  it('a 401 heartbeat signs the user out', async () => {
    session = { authenticated: true, deadlineAt: T0 + 30_000, expiresAt: T0 + 8 * 3600_000 }
    heartbeatResponse = { status: 401, body: {} }
    render(<AdminSessionController />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Continue working' }))
    await flush()
    expect(location.href).toBe('/admin/login')
  })

  it('reports activity as a heartbeat and unsubscribes on unmount', async () => {
    session = { authenticated: true, deadlineAt: T0 + 90_000, expiresAt: T0 + 8 * 3600_000 }
    const { unmount } = render(<AdminSessionController />)
    await flush()
    fireEvent.mouseMove(window)
    await flush()
    // Activity alone only marks the tab dirty; a beat goes out once the deadline is urgent.
    expect(hit('/api/admin/session/heartbeat').length).toBeGreaterThan(0)
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('refetches the session and reconnects the stream when the tab regains focus', async () => {
    render(<AdminSessionController />)
    await flush()
    const before = hit('/api/admin/check-session').length
    await flush(6000)
    fireEvent.focus(window)
    await flush()
    expect(reconnect).toHaveBeenCalled()
    expect(hit('/api/admin/check-session').length).toBe(before + 1)
  })
})
