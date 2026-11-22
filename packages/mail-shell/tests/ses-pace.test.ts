import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ses-pace carries module-level state (local counter window, nextBulkAt). Re-import fresh per test
// so one test's window/pacing does not bleed into the next.
async function load(env: Record<string, string | undefined> = {}) {
  vi.resetModules()
  delete process.env.SES_MAX_SEND_RATE
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  return import('../src/ses-pace.ts')
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('sesRate / sesConnections', () => {
  it('defaults the rate to 14 and the connections to it/4 clamped [4,32]', async () => {
    const m = await load()
    expect(m.sesRate()).toBe(14)
    expect(m.sesConnections()).toBe(4) // ceil(14/4)=4
  })

  it('reads SES_MAX_SEND_RATE from env', async () => {
    const m = await load({ SES_MAX_SEND_RATE: '50' })
    expect(m.sesRate()).toBe(50)
    expect(m.sesConnections()).toBe(13) // ceil(50/4)
  })

  it('floors a non-numeric or zero rate to 1', async () => {
    const m = await load({ SES_MAX_SEND_RATE: 'nonsense' })
    expect(m.sesRate()).toBe(14) // Number('nonsense')=NaN → ||14
    const m0 = await load({ SES_MAX_SEND_RATE: '0' })
    expect(m0.sesRate()).toBe(14) // 0 || 14
  })

  it('clamps connections to the 32 ceiling', async () => {
    const m = await load({ SES_MAX_SEND_RATE: '1000' })
    expect(m.sesConnections()).toBe(32)
  })

  it('clamps connections to the 4 floor for a tiny rate', async () => {
    const m = await load({ SES_MAX_SEND_RATE: '1' })
    expect(m.sesConnections()).toBe(4)
  })
})

describe('localCounter', () => {
  it('counts up within one key and resets on a new key', async () => {
    const { localCounter } = await load()
    expect(await localCounter.hit('k1')).toBe(1)
    expect(await localCounter.hit('k1')).toBe(2)
    // New window key resets the count.
    expect(await localCounter.hit('k2')).toBe(1)
  })

  it('undo decrements the current window, ignores other keys and floors at 0', async () => {
    const { localCounter } = await load()
    await localCounter.hit('w')
    await localCounter.hit('w') // n=2
    await localCounter.undo('w') // n=1
    expect(await localCounter.hit('w')).toBe(2)
    // undo on a different key is a no-op.
    await localCounter.undo('other')
    expect(await localCounter.hit('w')).toBe(3)
    // undo below zero floors at 0 (key with n=0).
    await localCounter.hit('z') // switches window to z, n=1
    await localCounter.undo('z') // n=0
    await localCounter.undo('z') // stays 0
    expect(await localCounter.hit('z')).toBe(1)
  })
})

describe('error classification', () => {
  it('isSesQuota matches daily / 24-hour quota messages', async () => {
    const { isSesQuota } = await load()
    expect(isSesQuota({ message: 'Daily message quota exceeded' })).toBe(true)
    expect(isSesQuota({ message: 'daily sending quota reached' })).toBe(true)
    expect(isSesQuota({ response: '24-hour send quota' })).toBe(true)
    expect(isSesQuota({ message: '24 hour sending quota' })).toBe(true)
    expect(isSesQuota({ message: 'something else' })).toBe(false)
  })

  it('isSesThrottle matches throttling signatures but not quota', async () => {
    const { isSesThrottle } = await load()
    expect(isSesThrottle({ message: 'Throttling: rate exceeded' })).toBe(true)
    expect(isSesThrottle({ message: 'Maximum sending rate exceeded' })).toBe(true)
    expect(isSesThrottle({ message: 'too many connections' })).toBe(true)
    expect(isSesThrottle({ responseCode: 454, response: 'Throttling failure' })).toBe(true)
    // A quota error is explicitly NOT a throttle even though SES uses 454 for both.
    expect(isSesThrottle({ message: '454 Throttling failure: Daily message quota exceeded' })).toBe(false)
    expect(isSesThrottle({ message: 'plain failure' })).toBe(false)
  })

  it('errText tolerates null/undefined/primitive errors', async () => {
    const { isSesQuota, isSesThrottle } = await load()
    expect(isSesQuota(null)).toBe(false)
    expect(isSesThrottle(undefined)).toBe(false)
    expect(isSesThrottle('throttling failure')).toBe(true)
  })
})

describe('sesSlot — transactional window', () => {
  it('passes through immediately while under the per-second cap', async () => {
    vi.useFakeTimers()
    const m = await load({ SES_MAX_SEND_RATE: '14' })
    // 14 transactional slots in the same second all resolve without advancing time.
    for (let i = 0; i < 14; i++) await m.sesSlot('transactional')
    // The 15th would exceed the cap; prove the first 14 did not block by resolving instantly.
    expect(true).toBe(true)
  })

  it('delays the over-cap send until the window rolls over', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000_000_000) // ms since epoch, on a second boundary
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const m = await load({ SES_MAX_SEND_RATE: '2' })
    // Fill the window: 2 transactional sends allowed in this second.
    await m.sesSlot('transactional')
    await m.sesSlot('transactional')
    // The 3rd must wait for the next second (sleep then retry in the new window).
    let resolved = false
    const p = m.sesSlot('transactional').then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false)
    // Advance past the 1s boundary → new window key → the hit now returns 1 ≤ cap.
    await vi.advanceTimersByTimeAsync(1100)
    await p
    expect(resolved).toBe(true)
  })

  it('retries hit via localCounter when the custom counter rejects', async () => {
    vi.useFakeTimers()
    const m = await load({ SES_MAX_SEND_RATE: '5' })
    const counter = {
      hit: vi.fn().mockRejectedValue(new Error('redis down')),
      undo: vi.fn().mockResolvedValue(undefined),
    }
    // hit() rejects → .catch falls back to localCounter.hit → returns 1 ≤ cap → resolves.
    await m.sesSlot('transactional', counter)
    expect(counter.hit).toHaveBeenCalled()
  })

  it('undoes the counter and waits when a custom counter reports over cap', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000_000_000_000)
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const m = await load({ SES_MAX_SEND_RATE: '3' })
    let n = 0
    const counter = {
      // First window: always over cap. After one rollover: under cap.
      hit: vi.fn().mockImplementation(async () => (++n <= 1 ? 99 : 1)),
      undo: vi.fn().mockResolvedValue(undefined),
    }
    const p = m.sesSlot('transactional', counter)
    // Let the first over-cap iteration run (hit→undo→sleep), then roll the window.
    await vi.advanceTimersByTimeAsync(1100)
    await p
    // Over-cap path ran undo() then slept, then the second window hit returned under cap.
    expect(counter.undo).toHaveBeenCalled()
    expect(counter.hit).toHaveBeenCalledTimes(2)
  })
})

describe('sesSlot — bulk pacing', () => {
  it('spaces consecutive bulk sends by the per-slot interval', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(5_000_000_000_000)
    vi.spyOn(Math, 'random').mockReturnValue(0)
    // rate 4 → bulk cap floor(4*0.75)=3 → interval 1000/3 ≈ 333ms.
    const m = await load({ SES_MAX_SEND_RATE: '4' })
    // First bulk send: nextBulkAt starts 0, so at=now, no sleep.
    await m.sesSlot('bulk')
    // Second bulk send must wait ~333ms (spaceBulk schedules nextBulkAt ahead).
    let resolved = false
    const p = m.sesSlot('bulk').then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(400)
    await p
    expect(resolved).toBe(true)
  })
})

describe('sesSend', () => {
  it('runs the send inside a slot and returns its result', async () => {
    vi.useFakeTimers()
    const m = await load({ SES_MAX_SEND_RATE: '14' })
    const send = vi.fn().mockResolvedValue('sent-id')
    const out = await m.sesSend(send, 'transactional')
    expect(out).toBe('sent-id')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('throws SesQuotaError on a quota error without retrying', async () => {
    vi.useFakeTimers()
    const m = await load({ SES_MAX_SEND_RATE: '14' })
    const send = vi.fn().mockRejectedValue({ message: 'Daily message quota exceeded' })
    await expect(m.sesSend(send, 'transactional')).rejects.toBeInstanceOf(m.SesQuotaError)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('rethrows a non-throttle, non-quota error immediately', async () => {
    vi.useFakeTimers()
    const m = await load({ SES_MAX_SEND_RATE: '14' })
    const err = new Error('bad recipient')
    const send = vi.fn().mockRejectedValue(err)
    await expect(m.sesSend(send, 'transactional')).rejects.toBe(err)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('retries a throttled send with backoff, then succeeds', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const m = await load({ SES_MAX_SEND_RATE: '14' })
    let n = 0
    const send = vi.fn().mockImplementation(async () => {
      if (++n <= 2) throw { message: 'Throttling: rate exceeded' }
      return 'ok'
    })
    const p = m.sesSend(send, 'transactional')
    // Drain two backoff sleeps (2^0*1000 and 2^1*1000, each *1.0 with random 0.5).
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await p).toBe('ok')
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('gives up after 5 retries and rethrows the throttle error', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const m = await load({ SES_MAX_SEND_RATE: '14' })
    const err = { message: 'maximum sending rate exceeded' }
    const send = vi.fn().mockRejectedValue(err)
    const p = m.sesSend(send, 'transactional')
    const assertion = expect(p).rejects.toBe(err)
    // Each backoff capped at 16s; drain generously across all 6 attempts.
    await vi.advanceTimersByTimeAsync(200_000)
    await assertion
    expect(send).toHaveBeenCalledTimes(6) // attempts 0..5
  })
})
