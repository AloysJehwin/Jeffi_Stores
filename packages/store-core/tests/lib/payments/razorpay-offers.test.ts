import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(async () => []) }))
vi.mock('@/lib/integrations/resolve', () => ({ resolveRazorpayCreds: vi.fn() }))

import { fetchAccountOffers, getAccountOffers, getPublicOffers, getOffersWithSettings } from '@/lib/payments/razorpay-offers'
import { queryMany } from '@/lib/shared/db'
import { resolveRazorpayCreds } from '@/lib/integrations/resolve'

let keyCounter = 0
const liveKey = () => `rzp_live_${keyCounter++}` // unique per test → bypass module cache
const fetchMock = vi.fn()

const activeOffer = (over: Record<string, unknown> = {}) => ({
  id: 'offer_1',
  display_name: 'Flat 10% on HDFC',
  status: 'ACTIVE',
  ends_at: 1_800_000_000,
  terms: { tnc: ' use once ' },
  rules: { items: [{ criteria: { includes: { paymentInstrument: { methods: ['card'], card: { issuers: ['HDFC', 'ZZZZ'] } } } } }] },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(queryMany).mockResolvedValue([] as any)
})

describe('fetchAccountOffers', () => {
  it('reports no_keys when creds are missing', async () => {
    vi.mocked(resolveRazorpayCreds).mockResolvedValue({ key_id: '', key_secret: '' } as any)
    const r = await fetchAccountOffers()
    expect(r).toMatchObject({ ok: false, reason: 'no_keys' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('normalises active offers and maps issuer codes', async () => {
    const key_id = liveKey()
    vi.mocked(resolveRazorpayCreds).mockResolvedValue({ key_id, key_secret: 's' } as any)
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [activeOffer()] }) })
    const r = await fetchAccountOffers()
    expect(r.ok).toBe(true)
    expect(r.offers).toHaveLength(1)
    expect(r.offers[0]).toMatchObject({ id: 'offer_1', title: 'Flat 10% on HDFC', methods: ['card'], terms: 'use once' })
    expect(r.offers[0].issuers).toEqual(['HDFC Bank', 'ZZZZ'])
    expect(r.offers[0].endsAt).toMatch(/^20/)
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toMatch(/^Basic /)
  })

  it('drops inactive, hidden, and title-less offers', async () => {
    const key_id = liveKey()
    vi.mocked(resolveRazorpayCreds).mockResolvedValue({ key_id, key_secret: 's' } as any)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          { id: 'a', status: 'DEACTIVATED', display_name: 'x' },
          { id: 'b', status: 'ACTIVE', display_config: { is_hidden: true }, display_name: 'y' },
          { id: 'c', status: 'ACTIVE', display_name: '  ' },
        ],
      }),
    })
    const r = await fetchAccountOffers()
    expect(r.offers).toEqual([])
  })

  it('serves from cache on a second call within TTL', async () => {
    const key_id = liveKey()
    vi.mocked(resolveRazorpayCreds).mockResolvedValue({ key_id, key_secret: 's' } as any)
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [activeOffer()] }) })
    await fetchAccountOffers()
    const second = await fetchAccountOffers()
    expect(second.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports test_mode on a non-ok response for a test key', async () => {
    vi.mocked(resolveRazorpayCreds).mockResolvedValue({ key_id: 'rzp_test_z', key_secret: 's' } as any)
    fetchMock.mockResolvedValue({ ok: false, status: 400 })
    const r = await fetchAccountOffers()
    expect(r).toMatchObject({ ok: false, reason: 'test_mode' })
  })

  it('reports unreachable on a non-ok response for a live key', async () => {
    const key_id = liveKey()
    vi.mocked(resolveRazorpayCreds).mockResolvedValue({ key_id, key_secret: 's' } as any)
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    const r = await fetchAccountOffers()
    expect(r).toMatchObject({ ok: false, reason: 'unreachable' })
  })

  it('reports unreachable when fetch throws', async () => {
    const key_id = liveKey()
    vi.mocked(resolveRazorpayCreds).mockResolvedValue({ key_id, key_secret: 's' } as any)
    fetchMock.mockRejectedValue(new Error('timeout'))
    const r = await fetchAccountOffers()
    expect(r).toMatchObject({ ok: false, reason: 'unreachable', detail: 'timeout' })
  })

  it('reports unreachable when resolveRazorpayCreds throws (caught to null)', async () => {
    vi.mocked(resolveRazorpayCreds).mockRejectedValue(new Error('cp down'))
    const r = await fetchAccountOffers()
    expect(r).toMatchObject({ ok: false, reason: 'no_keys' })
  })
})

describe('getAccountOffers', () => {
  it('returns just the offers array', async () => {
    const key_id = liveKey()
    vi.mocked(resolveRazorpayCreds).mockResolvedValue({ key_id, key_secret: 's' } as any)
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [activeOffer()] }) })
    expect(await getAccountOffers()).toHaveLength(1)
  })
})

describe('getOffersWithSettings', () => {
  it('merges db settings and defaults an internal-looking offer to hidden', async () => {
    const key_id = liveKey()
    vi.mocked(resolveRazorpayCreds).mockResolvedValue({ key_id, key_secret: 's' } as any)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [activeOffer({ id: 'o1', display_name: 'Real cashback' }), activeOffer({ id: 'o2', display_name: 'GPay UPI logo visibility offer' })],
      }),
    })
    vi.mocked(queryMany).mockResolvedValue([
      { offer_id: 'o1', is_visible: false, title_override: 'Renamed', display_order: 5, updated_at: 'now' },
    ] as any)
    const { offers } = await getOffersWithSettings()
    const o1 = offers.find(o => o.id === 'o1')!
    const o2 = offers.find(o => o.id === 'o2')!
    expect(o1.isVisible).toBe(false) // explicit setting wins
    expect(o1.titleOverride).toBe('Renamed')
    expect(o2.looksInternal).toBe(true)
    expect(o2.isVisible).toBe(false) // defaulted hidden, no row
  })

  it('tolerates a db failure (empty settings)', async () => {
    const key_id = liveKey()
    vi.mocked(resolveRazorpayCreds).mockResolvedValue({ key_id, key_secret: 's' } as any)
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [activeOffer({ id: 'ok1', display_name: 'Deal' })] }) })
    vi.mocked(queryMany).mockRejectedValue(new Error('db'))
    const { offers } = await getOffersWithSettings()
    expect(offers[0].isVisible).toBe(true)
  })
})

describe('getPublicOffers', () => {
  it('returns visible offers with any title override', async () => {
    const key_id = liveKey()
    vi.mocked(resolveRazorpayCreds).mockResolvedValue({ key_id, key_secret: 's' } as any)
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [activeOffer({ id: 'p1', display_name: 'Deal' })] }) })
    vi.mocked(queryMany).mockResolvedValue([
      { offer_id: 'p1', is_visible: true, title_override: 'Shiny', display_order: 0, updated_at: 'n' },
    ] as any)
    const offers = await getPublicOffers()
    expect(offers).toEqual([expect.objectContaining({ id: 'p1', title: 'Shiny' })])
  })

  it('filters out hidden offers', async () => {
    const key_id = liveKey()
    vi.mocked(resolveRazorpayCreds).mockResolvedValue({ key_id, key_secret: 's' } as any)
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [activeOffer({ id: 'p2', display_name: 'Deal' })] }) })
    vi.mocked(queryMany).mockResolvedValue([
      { offer_id: 'p2', is_visible: false, title_override: null, display_order: 0, updated_at: 'n' },
    ] as any)
    expect(await getPublicOffers()).toEqual([])
  })

  it('returns [] when the whole fetch fails', async () => {
    vi.mocked(resolveRazorpayCreds).mockResolvedValue({ key_id: '', key_secret: '' } as any)
    expect(await getPublicOffers()).toEqual([])
  })
})
