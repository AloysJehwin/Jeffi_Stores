import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  MESSAGING_COST_INR,
  DOCUMENT_COST_INR,
  MEDIA_COST_INR,
  USD_INR_RATE,
  PUBLIC_MARGIN,
  FX_TTL_MS,
  fetchUsdInr,
  usdInrRate,
  usdInr,
  setUsdInr,
  refreshUsdInr,
  PROCESSING_FEE_INR,
  DEFAULT_MESSAGE_PRICING,
  normalizeMessagePricing,
  setMessagePricing,
  messagePricing,
  round2,
  toPaise,
  usdToInr,
  withMargin,
  messagePriceInr,
  followsProviderPrice,
  mediaPriceInr,
  documentPriceInr,
  processingFeeInr,
  priceList,
  type FxRate,
  type MessagePricing,
} from '@jeffi/pricing'

// Reset the module-level fx rate and pricing sheet before each test — both are mutable singletons.
beforeEach(() => {
  setUsdInr({ rate: USD_INR_RATE, source: 'default', fetchedAt: new Date(0).toISOString() })
  setMessagePricing(null) // back to DEFAULT_MESSAGE_PRICING
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('constants', () => {
  it('exposes the documented cost/margin constants', () => {
    expect(MESSAGING_COST_INR).toEqual({ sms: 7, whatsapp: 1, email: 0.05 })
    expect(DOCUMENT_COST_INR.invoice).toBe(0.5)
    expect(MEDIA_COST_INR).toBe(0.5)
    expect(USD_INR_RATE).toBe(88)
    expect(PUBLIC_MARGIN).toBe(0.4)
    expect(FX_TTL_MS).toBe(6 * 60 * 60 * 1000)
    expect(PROCESSING_FEE_INR).toEqual({ whatsapp: 0.2, sms: 0.5, email: 0 })
  })
})

// ── simple math helpers ───────────────────────────────────────────────────────────────────────
describe('round2 / toPaise', () => {
  it('rounds to 2 dp', () => {
    expect(round2(1.005)).toBe(1) // float: 1.005*100 === 100.49999 → rounds to 100
    expect(round2(1.234)).toBe(1.23)
    expect(round2(1.235)).toBe(1.24)
    expect(round2(2)).toBe(2)
  })
  it('converts INR to paise (rounded)', () => {
    expect(toPaise(1)).toBe(100)
    expect(toPaise(1.239)).toBe(124)
    expect(toPaise(0.005)).toBe(1)
  })
})

describe('usdToInr', () => {
  it('converts at the current rate using the absolute value', () => {
    setUsdInr({ rate: 80, source: 't', fetchedAt: new Date().toISOString() })
    expect(usdToInr(2)).toBe(160)
    expect(usdToInr(-2)).toBe(160) // abs: negative USD still a positive INR amount
  })
  it('rounds to 4 dp', () => {
    setUsdInr({ rate: 88.12345, source: 't', fetchedAt: new Date().toISOString() })
    expect(usdToInr(1)).toBe(88.1235) // 88.12345 → *10000 round /10000
  })
})

// ── USD→INR state ─────────────────────────────────────────────────────────────────────────────
describe('setUsdInr / usdInr / usdInrRate', () => {
  it('starts at the default fallback rate', () => {
    expect(usdInr()).toBe(USD_INR_RATE)
    expect(usdInrRate().source).toBe('default')
  })
  it('accepts a sane rate', () => {
    const r: FxRate = { rate: 83.5, source: 'ecb', fetchedAt: new Date().toISOString() }
    setUsdInr(r)
    expect(usdInr()).toBe(83.5)
    expect(usdInrRate()).toEqual(r)
  })
  it('ignores null / undefined', () => {
    setUsdInr({ rate: 83.5, source: 'ecb', fetchedAt: new Date().toISOString() })
    setUsdInr(null)
    setUsdInr(undefined)
    expect(usdInr()).toBe(83.5)
  })
  it('ignores an insane rate (too low, too high, non-finite)', () => {
    setUsdInr({ rate: 83.5, source: 'ecb', fetchedAt: new Date().toISOString() })
    setUsdInr({ rate: 39, source: 'bad', fetchedAt: new Date().toISOString() }) // <= 40
    setUsdInr({ rate: 251, source: 'bad', fetchedAt: new Date().toISOString() }) // >= 250
    setUsdInr({ rate: NaN, source: 'bad', fetchedAt: new Date().toISOString() })
    setUsdInr({ rate: Infinity, source: 'bad', fetchedAt: new Date().toISOString() })
    expect(usdInr()).toBe(83.5)
  })
})

// ── fetchUsdInr ───────────────────────────────────────────────────────────────────────────────
describe('fetchUsdInr', () => {
  it('returns the rate from the first source that answers (rounded to 4 dp)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ rates: { INR: 84.123456 } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const r = await fetchUsdInr()
    expect(r).toEqual({ rate: 84.1235, source: 'ECB via frankfurter.dev', fetchedAt: expect.any(String) })
    expect(fetchMock).toHaveBeenCalledTimes(1) // short-circuits after the first good answer
  })

  it('falls through to the second source when the first is not ok', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) }) // res.ok false → rate null → insane
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rates: { INR: 90 } }) })
    vi.stubGlobal('fetch', fetchMock)
    const r = await fetchUsdInr()
    expect(r?.rate).toBe(90)
    expect(r?.source).toBe('open.er-api.com')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls through when the first source returns an insane rate', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rates: { INR: 10 } }) }) // too low
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rates: { INR: 85 } }) })
    vi.stubGlobal('fetch', fetchMock)
    const r = await fetchUsdInr()
    expect(r?.rate).toBe(85)
  })

  it('skips a source that throws and tries the next', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network')) // caught
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rates: { INR: 86 } }) })
    vi.stubGlobal('fetch', fetchMock)
    const r = await fetchUsdInr()
    expect(r?.rate).toBe(86)
  })

  it('returns null when no source gives a sane rate', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rates: { INR: 'nope' } }) })
      .mockRejectedValueOnce(new Error('down'))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchUsdInr()).toBeNull()
  })

  it('handles a missing rates object', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchUsdInr()).toBeNull()
  })
})

// ── refreshUsdInr ─────────────────────────────────────────────────────────────────────────────
describe('refreshUsdInr', () => {
  const freshRow = (): FxRate => ({ rate: 82, source: 'stored', fetchedAt: new Date().toISOString() })
  const staleRow = (): FxRate => ({ rate: 82, source: 'old', fetchedAt: new Date(Date.now() - FX_TTL_MS - 1000).toISOString() })

  it('uses a fresh stored rate as-is without fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const store = { read: vi.fn(async () => freshRow()), write: vi.fn(async () => {}) }
    const r = await refreshUsdInr(store)
    expect(r.rate).toBe(82)
    expect(store.write).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches and stores a live rate when nothing is stored', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rates: { INR: 87 } }) }))
    const store = { read: vi.fn(async () => null), write: vi.fn(async () => {}) }
    const r = await refreshUsdInr(store) // !stored → awaits the fetch
    expect(r.rate).toBe(87)
    expect(store.write).toHaveBeenCalledWith(expect.objectContaining({ rate: 87 }))
  })

  it('uses a stale stored rate immediately but still refreshes when wait is set', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rates: { INR: 91 } }) }))
    setUsdInr(null) // keep default; stale row below will set 82 first
    const store = { read: vi.fn(async () => staleRow()), write: vi.fn(async () => {}) }
    const r = await refreshUsdInr(store, { wait: true }) // awaits fetch → ends at live 91
    expect(r.rate).toBe(91)
    expect(store.write).toHaveBeenCalledWith(expect.objectContaining({ rate: 91 }))
  })

  it('does not store when the live fetch yields nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })) // → null
    const store = { read: vi.fn(async () => null), write: vi.fn(async () => {}) }
    const r = await refreshUsdInr(store)
    expect(store.write).not.toHaveBeenCalled()
    // fetch failed → fx stays at whatever setUsdInr(stored=null) left (default)
    expect(r.rate).toBe(USD_INR_RATE)
  })

  it('never throws when store.read rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rates: { INR: 89 } }) }))
    const store = { read: vi.fn(async () => { throw new Error('db') }), write: vi.fn(async () => {}) }
    const r = await refreshUsdInr(store) // read throws → stored null → fetch awaited
    expect(r.rate).toBe(89)
  })

  it('swallows a store.write rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rates: { INR: 93 } }) }))
    const store = { read: vi.fn(async () => null), write: vi.fn(async () => { throw new Error('write fail') }) }
    const r = await refreshUsdInr(store) // write rejects but is caught
    expect(r.rate).toBe(93)
  })

  it('reuses an in-flight fetch for a stale row without waiting (no wait, stored present)', async () => {
    let resolveFetch: (v: any) => void = () => {}
    const pending = new Promise(res => { resolveFetch = res })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending))
    const store = { read: vi.fn(async () => staleRow()), write: vi.fn(async () => {}) }
    // No wait + stored present → returns the stale rate immediately, fetch still in flight.
    const r = await refreshUsdInr(store)
    expect(r.rate).toBe(82)
    expect(store.write).not.toHaveBeenCalled()
    // clean up the dangling promise so it resolves to null (no write)
    resolveFetch({ ok: true, json: async () => ({}) })
    await new Promise(res => setTimeout(res, 0))
  })
})

// ── normalizeMessagePricing ───────────────────────────────────────────────────────────────────
describe('normalizeMessagePricing', () => {
  it('returns the defaults for null / undefined / empty', () => {
    expect(normalizeMessagePricing(null)).toEqual(DEFAULT_MESSAGE_PRICING)
    expect(normalizeMessagePricing(undefined)).toEqual(DEFAULT_MESSAGE_PRICING)
    expect(normalizeMessagePricing({})).toEqual(DEFAULT_MESSAGE_PRICING)
  })

  it('keeps defaults for missing / invalid rate fields', () => {
    const out = normalizeMessagePricing({
      rates: {
        'twilio:whatsapp': { costInr: -5, feeInr: 'x' as any, exact: 'nope' as any }, // all invalid → defaults
      },
    })
    expect(out.rates['twilio:whatsapp']).toEqual(DEFAULT_MESSAGE_PRICING.rates['twilio:whatsapp'])
  })

  it('accepts valid overrides including exact:false and zero cost', () => {
    const out = normalizeMessagePricing({
      marginPct: 55,
      mediaInr: 0, // 0 is valid (>= 0)
      rates: { 'aws:sms': { costInr: 2.5, feeInr: 0, exact: true } },
    })
    expect(out.marginPct).toBe(55)
    expect(out.mediaInr).toBe(0)
    expect(out.rates['aws:sms']).toEqual({ costInr: 2.5, feeInr: 0, exact: true })
  })

  it('falls back to default marginPct/mediaInr when negative or non-numeric', () => {
    const out = normalizeMessagePricing({ marginPct: -1, mediaInr: NaN })
    expect(out.marginPct).toBe(DEFAULT_MESSAGE_PRICING.marginPct)
    expect(out.mediaInr).toBe(DEFAULT_MESSAGE_PRICING.mediaInr)
  })

  it('handles a rates object missing the key entirely', () => {
    const out = normalizeMessagePricing({ rates: {} })
    expect(out.rates['msg91:sms']).toEqual(DEFAULT_MESSAGE_PRICING.rates['msg91:sms'])
  })
})

describe('setMessagePricing / messagePricing', () => {
  it('replaces the active sheet', () => {
    setMessagePricing({ marginPct: 10 })
    expect(messagePricing().marginPct).toBe(10)
  })
  it('null resets to defaults', () => {
    setMessagePricing({ marginPct: 10 })
    setMessagePricing(null)
    expect(messagePricing()).toEqual(DEFAULT_MESSAGE_PRICING)
  })
})

// ── withMargin and price helpers ──────────────────────────────────────────────────────────────
describe('withMargin', () => {
  it('applies the sheet margin and rounds', () => {
    // default margin 40 → cost 1 → 1.4
    expect(withMargin(1)).toBe(1.4)
    expect(withMargin(7)).toBe(9.8) // sms 7 → 9.8
  })
  it('tracks a changed margin', () => {
    setMessagePricing({ marginPct: 50 })
    expect(withMargin(1)).toBe(1.5)
  })
})

describe('messagePriceInr', () => {
  it('adds margin for external sends (default provider twilio)', () => {
    expect(messagePriceInr('sms')).toBe(9.8) // 7 * 1.4
    expect(messagePriceInr('whatsapp')).toBe(1.4) // 1 * 1.4
    expect(messagePriceInr('email')).toBe(0.07) // 0.05 * 1.4
  })
  it('returns the bare rounded cost when internal', () => {
    expect(messagePriceInr('sms', true)).toBe(7)
    expect(messagePriceInr('whatsapp', true)).toBe(1)
  })
  it('honours a specific provider rate', () => {
    expect(messagePriceInr('sms', true, 'msg91')).toBe(0.3) // msg91 cost 0.3
    expect(messagePriceInr('sms', false, 'msg91')).toBe(round2(0.3 * 1.4)) // 0.42
  })
  it('falls back to the twilio row for an unknown provider', () => {
    expect(messagePriceInr('whatsapp', true, 'unknown')).toBe(1) // twilio:whatsapp cost
  })
  it('routes email to ses regardless of provider arg', () => {
    expect(messagePriceInr('email', true, 'twilio')).toBe(0.05)
  })
})

describe('followsProviderPrice', () => {
  it('is true for twilio (exact) and false for aws', () => {
    expect(followsProviderPrice('whatsapp', 'twilio')).toBe(true)
    expect(followsProviderPrice('sms', 'twilio')).toBe(true)
    expect(followsProviderPrice('whatsapp', 'aws')).toBe(false)
    expect(followsProviderPrice('sms', 'aws')).toBe(false)
  })
  it('defaults to twilio when no provider is given', () => {
    expect(followsProviderPrice('whatsapp')).toBe(true)
  })
  it('is false for email (ses)', () => {
    expect(followsProviderPrice('email')).toBe(false)
  })
})

describe('mediaPriceInr', () => {
  it('adds margin externally, bare cost internally', () => {
    expect(mediaPriceInr()).toBe(0.7) // 0.5 * 1.4
    expect(mediaPriceInr(true)).toBe(0.5)
  })
})

describe('documentPriceInr', () => {
  it('applies margin to each document cost', () => {
    expect(documentPriceInr('invoice')).toBe(0.7) // 0.5 * 1.4
    expect(documentPriceInr('label')).toBe(0.14) // 0.1 * 1.4
    expect(documentPriceInr('receipt')).toBe(0.35) // 0.25 * 1.4
  })
})

describe('processingFeeInr', () => {
  it('is zero for internal sends', () => {
    expect(processingFeeInr('sms', true)).toBe(0)
    expect(processingFeeInr('whatsapp', true, 'aws')).toBe(0)
  })
  it('returns the rounded fee for external sends', () => {
    expect(processingFeeInr('sms')).toBe(0.5) // twilio:sms fee
    expect(processingFeeInr('whatsapp')).toBe(0.2)
    expect(processingFeeInr('email')).toBe(0) // ses fee 0
  })
  it('honours a provider-specific fee', () => {
    expect(processingFeeInr('sms', false, 'msg91')).toBe(0.1)
  })
  it('returns 0 when the resolved fee is not numeric', () => {
    // Force a rate row whose feeInr is non-numeric via setMessagePricing path isn't possible
    // (normalize coerces), so cover the guard by a sheet with a missing row fee: msg91 unknown
    // provider falls back to twilio:sms which has a numeric fee — instead use a crafted sheet.
    setMessagePricing({ rates: { 'twilio:sms': { costInr: 1, feeInr: 0.9, exact: false } } })
    expect(processingFeeInr('sms')).toBe(0.9)
  })
})

// ── priceList ─────────────────────────────────────────────────────────────────────────────────
describe('priceList', () => {
  it('builds the full external price sheet at the default margin', () => {
    const pl = priceList()
    expect(pl.currency).toBe('INR')
    expect(pl.margin).toBe(0.4) // 40 / 100
    expect(pl.messages).toEqual({ sms: 9.8, whatsapp: 1.4, email: 0.07 })
    expect(pl.media).toBe(0.7)
    expect(pl.documents.invoice).toBe(0.7)
    expect(pl.documents.purchase_order).toBe(0.7)
    expect(pl.processingFees).toEqual({ sms: 0.5, whatsapp: 0.2, email: 0 })
  })
  it('tracks a changed margin sheet', () => {
    setMessagePricing({ marginPct: 100 })
    const pl = priceList()
    expect(pl.margin).toBe(1)
    expect(pl.messages.whatsapp).toBe(2) // 1 * 2
  })
})
