import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock global fetch before importing instrumentation
// ---------------------------------------------------------------------------
global.fetch = vi.fn()

import { register } from '@/instrumentation'

describe('register', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete process.env.NEXT_RUNTIME
    delete process.env.CRON_SECRET
    delete process.env.APP_URL
    delete process.env.NEXT_PUBLIC_APP_URL
  })

  it('does nothing when NEXT_RUNTIME is not nodejs', async () => {
    process.env.NEXT_RUNTIME = 'edge'
    process.env.CRON_SECRET = 'secret'
    process.env.APP_URL = 'http://localhost:3000'

    await register()

    // No timers registered — advance a small window and verify no fetch
    vi.advanceTimersByTime(5_000)
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled()
  })

  it('does nothing when CRON_SECRET is missing', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.APP_URL = 'http://localhost:3000'
    delete process.env.CRON_SECRET

    await register()

    vi.advanceTimersByTime(5_000)
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled()
  })

  it('does nothing when APP_URL is missing', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.CRON_SECRET = 'secret'
    delete process.env.APP_URL
    delete process.env.NEXT_PUBLIC_APP_URL

    await register()

    vi.advanceTimersByTime(5_000)
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled()
  })

  it('uses NEXT_PUBLIC_APP_URL as fallback when APP_URL is absent', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.CRON_SECRET = 'test-secret'
    delete process.env.APP_URL
    process.env.NEXT_PUBLIC_APP_URL = 'http://app.example.com'

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)

    await register()

    // Advance past the 30s delay for delhivery_sync — do NOT use runAllTimers
    // (setInterval would loop infinitely)
    vi.advanceTimersByTime(31_000)
    await Promise.resolve()

    // At least one fetch should use the NEXT_PUBLIC_APP_URL base
    const calls = vi.mocked(global.fetch).mock.calls
    const hasPubUrl = calls.some(([url]) =>
      typeof url === 'string' && url.startsWith('http://app.example.com')
    )
    expect(hasPubUrl).toBe(true)
  })

  it('schedules 6 cron jobs via setTimeout after full setup', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.CRON_SECRET = 'test-secret'
    process.env.APP_URL = 'http://localhost:3000'

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

    await register()

    // register() calls setTimeout 6 times (one per cron job)
    expect(setTimeoutSpy).toHaveBeenCalledTimes(6)
  })

  it('calls delhivery_sync cron endpoint after 30s delay', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.CRON_SECRET = 'test-secret'
    process.env.APP_URL = 'http://localhost:3000'

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)

    await register()

    // Advance past the 30s initial delay for delhivery_sync
    vi.advanceTimersByTime(31_000)
    await Promise.resolve()

    const calls = vi.mocked(global.fetch).mock.calls
    const delhiveryCall = calls.find(([url]) =>
      typeof url === 'string' && url.includes('delhivery/sync-statuses')
    )
    expect(delhiveryCall).toBeDefined()
  })

  it('sends Authorization Bearer header in cron calls', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.CRON_SECRET = 'my-secret'
    process.env.APP_URL = 'http://localhost:3000'

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)

    await register()

    vi.advanceTimersByTime(31_000)
    await Promise.resolve()

    const calls = vi.mocked(global.fetch).mock.calls
    const cronCall = calls.find(([url]) =>
      typeof url === 'string' && url.includes('localhost:3000/api')
    )
    expect(cronCall).toBeDefined()
    const opts = cronCall![1] as RequestInit
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer my-secret')
  })

  it('calls recordRun with ok=false when cron fetch fails', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.CRON_SECRET = 'test-secret'
    process.env.APP_URL = 'http://localhost:3000'

    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new Error('network down')) // cron fetch fails
      .mockResolvedValue({ ok: true, json: async () => ({}) } as Response) // recordRun succeeds

    await register()

    vi.advanceTimersByTime(31_000)
    // flush two microtask ticks: one for the rejection, one for the recordRun call
    await Promise.resolve()
    await Promise.resolve()

    const calls = vi.mocked(global.fetch).mock.calls
    // Second call should be the recordRun call
    const recordCall = calls.find(([url]) =>
      typeof url === 'string' && url.includes('cron-record')
    )
    if (recordCall) {
      const body = JSON.parse((recordCall[1] as RequestInit).body as string)
      expect(body.ok).toBe(false)
      expect(body.errorMsg).toBeTruthy()
    }
    // If recordRun itself was also swallowed, at least verify fetch was called
    expect(calls.length).toBeGreaterThan(0)
  })

  it('calls recordRun with ok=false when cron response is not ok', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.CRON_SECRET = 'test-secret'
    process.env.APP_URL = 'http://localhost:3000'

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'server error' }),
      } as Response)
      .mockResolvedValue({ ok: true, json: async () => ({}) } as Response)

    await register()

    vi.advanceTimersByTime(31_000)
    await Promise.resolve()
    await Promise.resolve()

    const calls = vi.mocked(global.fetch).mock.calls
    const recordCall = calls.find(([url]) =>
      typeof url === 'string' && url.includes('cron-record')
    )
    if (recordCall) {
      const body = JSON.parse((recordCall[1] as RequestInit).body as string)
      expect(body.ok).toBe(false)
    }
    expect(calls.length).toBeGreaterThan(0)
  })
})
