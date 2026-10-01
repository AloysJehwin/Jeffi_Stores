import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openGoogleOAuthPopup } from '@/lib/client/google-oauth-popup'

describe('openGoogleOAuthPopup — server-side (window undefined)', () => {
  it('resolves with window unavailable error when window is not defined', async () => {
    // In happy-dom, window exists, so we temporarily remove it
    const savedWindow = globalThis.window
    // @ts-expect-error intentionally removing window
    delete globalThis.window
    const result = await openGoogleOAuthPopup({ clientId: 'test-client' })
    expect(result.accessToken).toBeNull()
    expect(result.error).toContain('window unavailable')
    // Restore
    globalThis.window = savedWindow
  })
})

describe('openGoogleOAuthPopup — popup blocked', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves with blocked error when window.open returns null', async () => {
    const origOpen = window.open
    window.open = vi.fn().mockReturnValue(null)
    const result = await openGoogleOAuthPopup({ clientId: 'test-client' })
    expect(result.accessToken).toBeNull()
    expect(result.error).toContain('blocked')
    window.open = origOpen
  })
})

describe('openGoogleOAuthPopup — postMessage with accessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with accessToken when postMessage arrives with valid token', async () => {
    const mockPopup = {
      closed: false,
      close: vi.fn(),
    }
    window.open = vi.fn().mockReturnValue(mockPopup)

    const promise = openGoogleOAuthPopup({ clientId: 'client-id' })

    // Dispatch a valid postMessage
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'jeffi-google-oauth', accessToken: 'token-abc' },
        origin: window.location.origin,
      })
    )

    const result = await promise
    expect(result.accessToken).toBe('token-abc')
    expect(result.error).toBeNull()
  })

  it('resolves with error when postMessage has error field', async () => {
    const mockPopup = { closed: false, close: vi.fn() }
    window.open = vi.fn().mockReturnValue(mockPopup)

    const promise = openGoogleOAuthPopup({ clientId: 'client-id' })

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'jeffi-google-oauth', error: 'access_denied' },
        origin: window.location.origin,
      })
    )

    const result = await promise
    expect(result.accessToken).toBeNull()
    expect(result.error).toBe('access_denied')
  })

  it('ignores postMessage from wrong origin', async () => {
    const mockPopup = { closed: false, close: vi.fn() }
    window.open = vi.fn().mockReturnValue(mockPopup)

    const promise = openGoogleOAuthPopup({ clientId: 'client-id' })

    // Send from wrong origin — should be ignored
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'jeffi-google-oauth', accessToken: 'evil-token' },
        origin: 'https://evil.com',
      })
    )

    // Then send the real one
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'jeffi-google-oauth', accessToken: 'real-token' },
        origin: window.location.origin,
      })
    )

    const result = await promise
    expect(result.accessToken).toBe('real-token')
  })

  it('ignores postMessage with wrong source field', async () => {
    const mockPopup = { closed: false, close: vi.fn() }
    window.open = vi.fn().mockReturnValue(mockPopup)

    const promise = openGoogleOAuthPopup({ clientId: 'client-id' })

    // Wrong source field — should be ignored
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'other-app', accessToken: 'fake-token' },
        origin: window.location.origin,
      })
    )

    // Send timeout to resolve
    vi.advanceTimersByTime(3 * 60 * 1000 + 100)
    const result = await promise
    expect(result.error).toContain('timed out')
  })

  it('resolves with timeout error after 3 minutes', async () => {
    const mockPopup = { closed: false, close: vi.fn() }
    window.open = vi.fn().mockReturnValue(mockPopup)

    const promise = openGoogleOAuthPopup({ clientId: 'client-id' })
    vi.advanceTimersByTime(3 * 60 * 1000 + 100)

    const result = await promise
    expect(result.accessToken).toBeNull()
    expect(result.error).toContain('timed out')
  })
})
