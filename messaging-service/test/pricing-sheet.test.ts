import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/db.js', () => ({ db: { query: vi.fn() } }))
const { refreshUsdInr, setMessagePricing } = vi.hoisted(() => ({ refreshUsdInr: vi.fn(), setMessagePricing: vi.fn() }))
vi.mock('@jeffi/pricing', async orig => ({ ...(await orig<any>()), refreshUsdInr, setMessagePricing }))

import { db } from '../src/db'
import { ensurePricing } from '../src/pricing-sheet'

describe('ensurePricing', () => {
  let base = Date.now()
  beforeEach(() => {
    vi.mocked(db.query).mockReset()
    refreshUsdInr.mockReset()
    setMessagePricing.mockReset()
    // Move past the module's 60s load cache (and 10m FX cache) so each case reloads.
    base += 20 * 60_000
    vi.spyOn(Date, 'now').mockReturnValue(base)
  })
  afterEach(() => { delete process.env.VITEST; vi.restoreAllMocks() })

  it('loads the pricing sheet from platform_infra into @jeffi/pricing', async () => {
    const sheet = { sms: { twilio: 7 } }
    vi.mocked(db.query).mockResolvedValue({ rows: [{ value: JSON.stringify(sheet) }] } as any)
    await ensurePricing()
    expect(String(vi.mocked(db.query).mock.calls.at(-1)![0])).toMatch(/message_pricing/)
    expect(setMessagePricing).toHaveBeenCalledWith(sheet)
  })

  it('under VITEST it never refreshes FX, but still loads the sheet', async () => {
    process.env.VITEST = '1'
    vi.mocked(db.query).mockResolvedValue({ rows: [{ value: null }] } as any)
    await ensurePricing()
    expect(refreshUsdInr).not.toHaveBeenCalled()
    expect(setMessagePricing).toHaveBeenCalledWith(null)
  })

  it('swallows a DB error — keeps the last sheet', async () => {
    process.env.VITEST = '1'
    vi.mocked(db.query).mockRejectedValue(new Error('no table'))
    await expect(ensurePricing()).resolves.toBeUndefined()
  })

  it('refreshes FX when not under VITEST, passing a store that reads/writes platform_infra', async () => {
    delete process.env.VITEST
    vi.mocked(db.query).mockResolvedValue({ rows: [{ value: null }] } as any)
    await ensurePricing()
    expect(refreshUsdInr).toHaveBeenCalledTimes(1)
    const store = refreshUsdInr.mock.calls[0][0] as { read: () => Promise<any>; write: (r: any) => Promise<void> }

    // read: parses the stored JSON, null when absent
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ value: JSON.stringify({ rate: 88, at: 1 }) }] } as any)
    expect(await store.read()).toEqual({ rate: 88, at: 1 })
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ value: null }] } as any)
    expect(await store.read()).toBeNull()

    // write: upserts the JSON value
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] } as any)
    await store.write({ rate: 90, at: 2 } as any)
    const call = vi.mocked(db.query).mock.calls.at(-1)!
    expect(String(call[0])).toMatch(/INSERT INTO platform_infra/)
    expect(call[1]).toEqual([JSON.stringify({ rate: 90, at: 2 })])
  })
})
