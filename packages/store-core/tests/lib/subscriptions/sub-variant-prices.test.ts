import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn() }))

import { query, queryOne, queryMany } from '@/lib/shared/db'
import {
  applyDraftSubVariantPrices,
  applyLiveSubVariantPrices,
  parseSubVariantPriceEntries,
} from '@/lib/subscriptions/sub-variant-prices'

const V1 = '11111111-1111-4111-8111-111111111111'
const SV1 = '22222222-2222-4222-8222-222222222222'
const SV2 = '33333333-3333-4333-8333-333333333333'

describe('sub-variant subscription prices', () => {
  beforeEach(() => vi.clearAllMocks())

  it('parses the form JSON, dropping malformed entries', () => {
    expect(parseSubVariantPriceEntries('nope')).toEqual([])
    expect(parseSubVariantPriceEntries(null)).toEqual([])
    expect(
      parseSubVariantPriceEntries(JSON.stringify([{ variant_id: V1, id: SV1, subscription_price: '5' }, { id: 1 }]))
    ).toEqual([{ variant_id: V1, id: SV1, subscription_price: '5' }])
  })

  it('live edit: updates only real sub-variant rows, normalized', async () => {
    await applyLiveSubVariantPrices('p1', [
      { variant_id: V1, id: SV1, subscription_price: '49.999' },
      { variant_id: V1, id: 'draft-sv-1', subscription_price: '10' },
      { variant_id: V1, id: SV2, subscription_price: '' },
    ])
    expect(query).toHaveBeenCalledTimes(2)
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([50, SV1, 'p1', null])
    expect(vi.mocked(query).mock.calls[1][1]).toEqual([null, SV2, 'p1', null])
  })

  it('live edit: writes per-interval prices when sent, leaves them alone when omitted', async () => {
    await applyLiveSubVariantPrices('p1', [
      { variant_id: V1, id: SV1, subscription_price: '', subscription_prices: { monthly: '99.999', weekly: '-1' } },
    ])
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([null, SV1, 'p1', JSON.stringify({ monthly: 100 })])
    expect(String(vi.mocked(query).mock.calls[0][0])).toMatch(/COALESCE\(\$4::jsonb, subscription_prices\)/)
  })

  it('draft edit: stages per-interval prices; unchanged maps are not rewritten', async () => {
    vi.mocked(queryOne).mockResolvedValue({
      sub_variants: [
        { id: SV1, variant_id: V1, subscription_price: null, subscription_prices: { monthly: 10 } },
        { id: SV2, variant_id: V1, subscription_price: null, subscription_prices: { yearly: 90 } },
      ],
    })
    await applyDraftSubVariantPrices('p1', [
      { variant_id: V1, id: SV1, subscription_price: '', subscription_prices: { monthly: '12', yearly: '' } },
      { variant_id: V1, id: SV2, subscription_price: '', subscription_prices: { yearly: '90.00' } },
    ])
    const written = JSON.parse(vi.mocked(query).mock.calls[0][1]![1] as string)
    expect(written[0]).toMatchObject({ subscription_prices: { monthly: 12 }, _edited: true })
    expect(written[1]._edited).toBeUndefined()
  })

  it('draft edit: updates a staged row and marks it edited', async () => {
    vi.mocked(queryOne).mockResolvedValue({
      sub_variants: [
        { id: 'draft-sv-1', variant_id: V1, sub_variant_name: 'A', subscription_price: null },
        { id: SV1, variant_id: V1, sub_variant_name: 'B', subscription_price: 20 },
      ],
    })
    await applyDraftSubVariantPrices('p1', [
      { variant_id: V1, id: 'draft-sv-1', subscription_price: '15' },
      { variant_id: V1, id: SV1, subscription_price: '20.00' }, // unchanged
    ])
    const written = JSON.parse(vi.mocked(query).mock.calls[0][1]![1] as string)
    expect(written[0]).toMatchObject({ subscription_price: 15, _edited: true })
    expect(written[1]._edited).toBeUndefined()
  })

  it('draft edit: no write when nothing changed', async () => {
    vi.mocked(queryOne).mockResolvedValue({ sub_variants: [{ id: SV1, variant_id: V1, subscription_price: 20 }] })
    await applyDraftSubVariantPrices('p1', [{ variant_id: V1, id: SV1, subscription_price: '20' }])
    expect(query).not.toHaveBeenCalled()
  })

  it('draft edit: seeds an untouched variant from live rows before staging the change', async () => {
    vi.mocked(queryOne).mockResolvedValue({ sub_variants: [] })
    vi.mocked(queryMany).mockResolvedValue([
      { id: SV1, variant_id: V1, sub_variant_name: 'A', subscription_price: null },
      { id: SV2, variant_id: V1, sub_variant_name: 'B', subscription_price: null },
    ])
    await applyDraftSubVariantPrices('p1', [{ variant_id: V1, id: SV2, subscription_price: '30' }])
    const written = JSON.parse(vi.mocked(query).mock.calls[0][1]![1] as string)
    expect(written).toHaveLength(2)
    expect(written.every((r: any) => r._seeded)).toBe(true)
    expect(written[1]).toMatchObject({ id: SV2, subscription_price: 30, _edited: true })
  })
})
