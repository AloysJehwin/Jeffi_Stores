import { describe, it, expect } from 'vitest'
import { buildTemplateWorkbook } from '@/lib/import/template'
import { parseWorkbook } from '@/lib/import/parse'
import { groupRows, parseSubscriptionIntervals } from '@/lib/import/validate-row'
import { backfillBlankOptionalFields, buildFields, buildSubVariants, buildVariants } from '@controller/lib/import/to-draft'
import { valuesToWorkbookBuffer } from '@/lib/import/google-sync'
import { columnsForSheet } from '@/lib/import/columns'
import * as XLSX from 'xlsx'

const NO_IDS = { categoryId: null, brandId: null, supplierId: null }
const P = ['sku', 'name', 'category', 'brand', 'base_price', 'has_variants']
const SUB = [
  'sku',
  'is_digital',
  'is_subscription',
  'subscription_intervals',
  'subscription_price',
  'subscription_price_monthly',
  'subscription_price_yearly',
  'subscription_total_cycles',
  'subscription_min_cycles',
]

function group(opts: {
  product?: Record<string, string>
  sub?: Record<string, string>
  variants?: string[][]
  subVariants?: string[][]
}) {
  const product = { sku: 'S1', name: 'Coffee', category: 'Cat', brand: 'Brand', base_price: '500', ...opts.product }
  const sheets: Record<string, string[][]> = { Products: [P, P.map(h => product[h as keyof typeof product] ?? '')] }
  if (opts.sub) sheets['Product · Digital'] = [SUB, SUB.map(h => (h === 'sku' ? 'S1' : (opts.sub![h] ?? '')))]
  if (opts.variants)
    sheets.Variants = [
      [
        'parent_sku',
        'variant.sku',
        'variant.variant_name',
        'variant.price',
        'variant.subscription_price',
        'variant.unit',
        'variant.subscription_price_quarterly',
      ],
      ...opts.variants,
    ]
  if (opts.subVariants)
    sheets['Sub-variants'] = [
      [
        'parent_sku',
        'variant_sku',
        'sub_variant.sub_variant_name',
        'sub_variant.sku',
        'sub_variant.price',
        'sub_variant.subscription_price',
        'sub_variant.subscription_price_monthly',
      ],
      ...opts.subVariants,
    ]
  const parsed = parseWorkbook(valuesToWorkbookBuffer(sheets))
  expect(parsed.fatal).toBeUndefined()
  const { groups } = groupRows(parsed.rows)
  expect(groups).toHaveLength(1)
  return groups[0]
}

describe('import: subscription columns', () => {
  it('ships the subscription columns in the template', async () => {
    const digital = columnsForSheet('Product · Digital').map(c => c.header)
    expect(digital).toEqual(
      expect.arrayContaining([
        'subscription_intervals',
        'subscription_price',
        'subscription_total_cycles',
        'subscription_min_cycles',
      ])
    )
    expect(columnsForSheet('Variants').map(c => c.header)).toContain('variant.subscription_price')
    expect(columnsForSheet('Sub-variants').map(c => c.header)).toContain('sub_variant.subscription_price')
    const wb = XLSX.read(await buildTemplateWorkbook(), { type: 'buffer' })
    const header = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Product · Digital'], { header: 1 })[0]
    expect(header).toContain('subscription_intervals')
  })

  it('parses pipe/comma intervals into the canonical array', () => {
    expect(parseSubscriptionIntervals('Yearly| weekly,monthly,weekly')).toEqual({
      intervals: ['weekly', 'monthly', 'yearly'],
      invalid: [],
    })
    expect(parseSubscriptionIntervals('monthly|daily').invalid).toEqual(['daily'])
  })

  it('maps a simple subscription product into draft fields', () => {
    const g = group({
      sub: {
        is_subscription: 'TRUE',
        subscription_intervals: 'monthly|quarterly',
        subscription_price: '450',
        subscription_total_cycles: '12',
        subscription_min_cycles: '3',
      },
    })
    expect(g.errors).toEqual([])
    expect(g.warnings).toEqual([])
    const f = buildFields(g, NO_IDS)
    expect(f).toMatchObject({
      is_subscription: true,
      subscription_intervals: ['monthly', 'quarterly'],
      subscription_price: 450,
      subscription_total_cycles: 12,
      subscription_min_cycles: 3,
    })
  })

  it('rejects unknown intervals and out-of-range cycle counts', () => {
    expect(group({ sub: { subscription_intervals: 'monthly|daily' } }).errors[0]).toMatch(/unknown "daily"/)
    expect(group({ sub: { subscription_total_cycles: '0' } }).errors[0]).toMatch(/between 1 and 520/)
    expect(group({ sub: { subscription_total_cycles: '521' } }).errors[0]).toMatch(/between 1 and 520/)
    expect(group({ sub: { subscription_min_cycles: '0' } }).errors[0]).toMatch(/greater than 0/)
    expect(group({ sub: { subscription_total_cycles: '6', subscription_min_cycles: '7' } }).errors[0]).toMatch(
      /cannot exceed/
    )
    expect(group({ sub: { subscription_total_cycles: '6', subscription_min_cycles: '6' } }).errors).toEqual([])
  })

  it('applies the sellable rule: variant and sub-variant prices kept, non-sellable levels warned + dropped', () => {
    const g = group({
      sub: { subscription_price: '400' },
      variants: [
        ['S1', 'S1-250', '250 g', '300', '270', ''],
        ['S1', 'S1-1K', '1 kg', '900', '800', ''],
      ],
      subVariants: [['S1', 'S1-1K', 'Whole bean', 'S1-1K-WB', '900', '780']],
    })
    expect(g.errors).toEqual([])
    expect(g.warnings).toHaveLength(2)
    expect(g.warnings[0]).toMatch(/product with variants/)
    expect(g.warnings[1]).toMatch(/variant "S1-1K".*sub-variants/)
    expect('subscription_price' in buildFields(g, NO_IDS)).toBe(false)
    const variants = buildVariants(g)
    expect(variants[0].subscription_price).toBe(270)
    expect('subscription_price' in variants[1]).toBe(false)
    const subs = buildSubVariants(g, new Map([['S1-1K', 'v-1k']]))
    expect(subs[0]).toMatchObject({ variant_id: 'v-1k', subscription_price: 780 })
  })

  it('ships per-interval price columns at every level', () => {
    for (const iv of ['weekly', 'monthly', 'quarterly', 'yearly']) {
      expect(columnsForSheet('Product · Digital').map(c => c.header)).toContain(`subscription_price_${iv}`)
      expect(columnsForSheet('Variants').map(c => c.header)).toContain(`variant.subscription_price_${iv}`)
      expect(columnsForSheet('Sub-variants').map(c => c.header)).toContain(`sub_variant.subscription_price_${iv}`)
    }
  })

  it('folds subscription_price_<interval> cells into subscription_prices on a simple product', () => {
    const g = group({ sub: { subscription_price_monthly: '499', subscription_price_yearly: '4999.999' } })
    expect(g.errors).toEqual([])
    const f = buildFields(g, NO_IDS)
    expect(f.subscription_prices).toEqual({ monthly: 499, yearly: 5000 })
    expect('subscription_price_monthly' in f).toBe(false)
    expect('subscription_prices' in buildFields(group({ sub: {} }), NO_IDS)).toBe(false)
  })

  it('rejects negative or over-cap interval prices', () => {
    expect(group({ sub: { subscription_price_monthly: '-5' } }).errors[0]).toMatch(/subscription_price_monthly must be 0 or more/)
    expect(group({ sub: { subscription_price_yearly: '15001' } }).errors[0]).toMatch(/cannot exceed ₹15,000/)
  })

  it('applies the sellable rule to interval prices', () => {
    const g = group({
      sub: { subscription_price_monthly: '400' },
      variants: [
        ['S1', 'S1-250', '250 g', '300', '', '', '800'],
        ['S1', 'S1-1K', '1 kg', '900', '', '', '2400'],
      ],
      subVariants: [['S1', 'S1-1K', 'Whole bean', 'S1-1K-WB', '900', '', '850']],
    })
    expect(g.errors).toEqual([])
    expect(g.warnings).toHaveLength(2)
    expect(g.warnings[0]).toMatch(/subscription_price_<interval> ignored on a product with variants/)
    expect(g.warnings[1]).toMatch(/variant "S1-1K".*subscription_price_<interval> ignored/)
    expect('subscription_prices' in buildFields(g, NO_IDS)).toBe(false)
    const variants = buildVariants(g)
    expect(variants[0].subscription_prices).toEqual({ quarterly: 800 })
    expect('subscription_prices' in variants[1]).toBe(false)
    const subs = buildSubVariants(g, new Map([['S1-1K', 'v-1k']]))
    expect(subs[0].subscription_prices).toEqual({ monthly: 850 })
  })

  it('re-import keeps live interval prices for blank cells', () => {
    const f = backfillBlankOptionalFields({ subscription_prices: { monthly: 450 } }, {
      subscription_prices: { monthly: 400, yearly: 4000 },
    })
    expect(f.subscription_prices).toEqual({ monthly: 450, yearly: 4000 })
  })

  it('rejects variant / sub-variant rows (and so variant units) on a digital product', () => {
    const g = group({
      sub: { is_digital: 'TRUE' },
      variants: [['S1', 'S1-A', 'A', '100', '', 'box']],
    })
    expect(g.errors.join(' ')).toMatch(/digital products cannot have variant or sub-variant rows/)
    const flagged = group({ product: { has_variants: 'TRUE' }, sub: { is_digital: 'TRUE' } })
    expect(flagged.errors.join(' ')).toMatch(/digital products cannot have variants/)
    expect(group({ sub: { is_digital: 'TRUE', subscription_intervals: 'monthly' } }).errors).toEqual([])
  })
})
