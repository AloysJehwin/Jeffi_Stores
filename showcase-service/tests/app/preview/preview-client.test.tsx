import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'

// The preview's live part: polls every 3s, re-renders on a new version and marks the changed sections, shows the
// "Your site is live" banner with a countdown after publish, and leaves for the live site when it runs out.

// Next's router is one stable object.
const { refresh, router } = vi.hoisted(() => {
  const refresh = vi.fn()
  return { refresh, router: { refresh } }
})
vi.mock('next/navigation', () => ({ useRouter: () => router }))

import PreviewClient, { changedSections, countdown, POLL_MS } from '@showcase/app/preview/PreviewClient'

const T0 = new Date('2026-11-24T10:00:00Z').getTime()
const DRAFT = { version: 'v1', status: 'draft' as const, live: false, expiresAt: '2026-11-25T10:00:00.000Z', sections: { hero: 'a', about: 'b' } }

const reply = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
let fetchMock: ReturnType<typeof vi.fn>
const location = { reload: vi.fn(), replace: vi.fn() }

describe('PreviewClient', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 })
    fetchMock = vi.fn(async () => reply(200, DRAFT))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('location', location)
    location.reload.mockReset()
    location.replace.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('lists changed sections and formats the countdown', () => {
    expect(changedSections({ hero: 'a', about: 'b' }, { hero: 'a', about: 'c', faq: 'd' })).toEqual(['about', 'faq'])
    expect(countdown(29 * 60_000 + 41_000)).toBe('29:41')
    expect(countdown(-5)).toBe('0:00')
  })

  it('shows the draft bar and polls the state with the token, sending no referrer', async () => {
    render(<PreviewClient token="a.b+c" state={DRAFT} />)
    expect(screen.getByRole('status').textContent).toMatch(/Preview of your site/)
    await act(async () => vi.advanceTimersByTimeAsync(POLL_MS))
    expect(fetchMock).toHaveBeenCalledWith('/preview/state?t=a.b%2Bc', { cache: 'no-store', referrerPolicy: 'no-referrer' })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('re-renders on a new version and marks the sections that changed', async () => {
    document.body.innerHTML = '<div id="hero"></div><div id="about"></div>'
    fetchMock.mockResolvedValueOnce(reply(200, { ...DRAFT, version: 'v2', sections: { hero: 'a', about: 'B' } }))
    const view = render(<PreviewClient token="tok" state={DRAFT} />, { container: document.body.appendChild(document.createElement('div')) })
    await act(async () => vi.advanceTimersByTimeAsync(POLL_MS))
    expect(refresh).toHaveBeenCalledOnce()
    // The refreshed server render arrives with the new version.
    view.rerender(<PreviewClient token="tok" state={{ ...DRAFT, version: 'v2', sections: { hero: 'a', about: 'B' } }} />)
    expect(document.getElementById('about')!.hasAttribute('data-preview-changed')).toBe(true)
    expect(document.getElementById('hero')!.hasAttribute('data-preview-changed')).toBe(false)
    await act(async () => vi.advanceTimersByTimeAsync(2500))
    expect(document.getElementById('about')!.hasAttribute('data-preview-changed')).toBe(false)
  })

  it('after publish: the live banner, a countdown, then the live site', async () => {
    const live = { ...DRAFT, status: 'live' as const, live: true, expiresAt: new Date(T0 + 90_000).toISOString() }
    fetchMock.mockImplementation(async () => reply(200, live))
    render(<PreviewClient token="tok" state={live} />)
    expect(screen.getByText('Your site is live')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to your live site' }).getAttribute('href')).toBe('/')
    expect(screen.getByText(/This preview closes in 1:30/)).toBeTruthy()
    await act(async () => vi.advanceTimersByTimeAsync(31_000))
    expect(screen.getByText(/This preview closes in 0:59/)).toBeTruthy()
    expect(location.replace).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(60_000))
    expect(location.replace).toHaveBeenCalledWith('/')
  })

  it('reloads (the page decides) once the link is refused', async () => {
    fetchMock.mockResolvedValueOnce(reply(410, { ok: false, state: 'expired' }))
    render(<PreviewClient token="tok" state={DRAFT} />)
    await act(async () => vi.advanceTimersByTimeAsync(POLL_MS))
    expect(location.reload).toHaveBeenCalledOnce()
    await act(async () => vi.advanceTimersByTimeAsync(POLL_MS * 2))
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
