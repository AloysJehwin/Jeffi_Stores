import { describe, it, expect, vi } from 'vitest'
import { matchSkus, pickMatches } from '@/lib/marketplace/match'

const row = (sku: string, matched_by: any, extra: Record<string, unknown> = {}) => ({
  sku,
  product_id: 'p-tee',
  variant_id: null,
  sub_variant_id: null,
  name: 'Crew Tee',
  variant_name: null,
  sub_variant_name: null,
  hsn_code: '6109',
  gst_rate: '5.00',
  matched_by,
  active: true,
  ...extra,
})

describe('marketplace SKU matching', () => {
  it('matches a size x colour sub-variant SKU to its variant and sub-variant', async () => {
    const db = {
      query: vi.fn(async () => ({
        rows: [row('TEE-RED-M', 'sub_variant', { variant_id: 'v-red', variant_name: 'Red', sub_variant_id: 'sv-red-m', sub_variant_name: 'M' })],
      })),
    }
    const m = await matchSkus(db as any, 'myntra', [' TEE-RED-M ', 'TEE-RED-M', ''])
    expect(db.query).toHaveBeenCalledTimes(1)
    expect((db.query.mock.calls[0] as any[])[1]).toEqual(['myntra', ['TEE-RED-M']])
    expect(m.get('TEE-RED-M')).toEqual({
      product_id: 'p-tee',
      variant_id: 'v-red',
      sub_variant_id: 'sv-red-m',
      name: 'Crew Tee',
      variant_name: 'Red',
      sub_variant_name: 'M',
      hsn_code: '6109',
      gst_rate: '5.00',
      matched_by: 'sub_variant',
    })
  })

  it('prefers the listing mapping, then sub-variant, variant, product; active units first', () => {
    const m = pickMatches([
      row('A', 'product'),
      row('A', 'variant', { variant_id: 'v1' }),
      row('A', 'listing', { variant_id: 'v9', sub_variant_id: 'sv9' }),
      row('B', 'variant', { variant_id: 'v-old', active: false }),
      row('B', 'variant', { variant_id: 'v-live' }),
      row('C', 'product'),
      row('C', 'sub_variant', { variant_id: 'v2', sub_variant_id: 'sv2' }),
    ])
    expect(m.get('A')).toMatchObject({ matched_by: 'listing', sub_variant_id: 'sv9' })
    expect(m.get('B')).toMatchObject({ variant_id: 'v-live' })
    expect(m.get('C')).toMatchObject({ matched_by: 'sub_variant', sub_variant_id: 'sv2' })
  })

  it('skips the query when there are no SKUs', async () => {
    const db = { query: vi.fn() }
    expect((await matchSkus(db as any, 'ajio', ['  '])).size).toBe(0)
    expect(db.query).not.toHaveBeenCalled()
  })
})
