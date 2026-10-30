import { describe, it, expect } from 'vitest'
import { quoteSpec, monthlyTotal, chargeFor } from '@controller/lib/compute/pricing'
import { PRESETS, presetOf, presetSpec, withHighAvailability } from '@/lib/compute/presets'
import { validateSpec, smallestFittingNode, planCompatibilityError } from '@/lib/compute/validate'
import type { Catalog, PlanCompute, PriceRow } from '@/lib/compute/spec'

// The seeded prices (database/control-plane/seed-plans.sql) and default settings.
const row = (code: string, kind: PriceRow['kind'], vcpu: number | null, memoryMib: number | null, h: number | null, hm: number | null, g: number | null, gm: number | null): PriceRow => ({
  code,
  kind,
  label: code,
  vcpu,
  memoryMib,
  usdHourly: h,
  usdHourlyMultiAz: hm,
  usdGbMonth: g,
  usdGbMonthMultiAz: gm,
  sellable: true,
  sort: 0,
})
const catalog: Catalog = {
  prices: [
    row('ec2:t4g.small', 'ec2', 2, 2048, 0.0168, null, null, null),
    row('ec2:t4g.medium', 'ec2', 2, 4096, 0.0336, null, null, null),
    row('ec2:t4g.large', 'ec2', 2, 8192, 0.0672, null, null, null),
    row('ec2:t4g.xlarge', 'ec2', 4, 16384, 0.1344, null, null, null),
    row('rds:db.t4g.micro', 'rds', 2, 1024, 0.016, 0.032, null, null),
    row('rds:db.t4g.small', 'rds', 2, 2048, 0.032, 0.065, null, null),
    row('rds:db.t4g.medium', 'rds', 2, 4096, 0.065, 0.129, null, null),
    row('rds:db.t4g.large', 'rds', 2, 8192, 0.129, 0.258, null, null),
    row('rds_storage:gp3', 'rds_storage', null, null, null, null, 0.115, 0.23),
    row('ebs:gp3', 'ebs', null, null, null, null, 0.08, null),
  ],
  settings: {
    usdInr: 88,
    margin: 0.25,
    gstRate: 0.18,
    platformShareUsd: 3,
    rootVolumeGb: 20,
    poolNodeType: 't4g.medium',
    poolCapacity: 4,
    sharedDbClass: 'db.t4g.small',
    sharedDbCapacity: 8,
    sharedDbStorageGb: 10,
    sharedDbMaxConnections: 200,
    minPrepayDays: 30,
    graceDays: 3,
  },
}
const starter: PlanCompute = { slug: 'starter', defaultPreset: 'shared', minPlacement: 'pool', advanced: false }
const pro: PlanCompute = { slug: 'pro', defaultPreset: 'medium', minPlacement: 'dedicated', advanced: true }
const presetsOnly: PlanCompute = { ...pro, advanced: false }
const growth: PlanCompute = { slug: 'growth', defaultPreset: 'small', minPlacement: 'dedicated', advanced: true }

describe('quoteSpec', () => {
  it('prices each preset as AWS cost × rate × (1 + margin)', () => {
    const month = (k: keyof typeof PRESETS) => Math.round(quoteSpec(presetSpec(k), catalog).inrMonth)
    expect([month('shared'), month('small'), month('medium'), month('large'), month('xlarge')]).toEqual([1496, 3393, 6027, 11754, 22922])
    const small = quoteSpec(presetSpec('small'), catalog)
    expect(Math.round(small.awsInrMonth)).toBe(2714)
    expect(small.inrDay).toBeCloseTo(111.55, 1)
    expect(small.marginInrMonth).toBeCloseTo(small.inrMonth - small.awsInrMonth, 1)
    expect(small.lines.map(l => l.key)).toEqual(['node', 'db', 'storage', 'platform'])
  })

  it('doubles the database for a standby and adds a second server for high availability', () => {
    expect(Math.round(quoteSpec(withHighAvailability(presetSpec('large')), catalog).inrMonth)).toBe(23098)
  })

  it('adds GST on servers to the plan fee, and bills by the hour', () => {
    const q = quoteSpec(presetSpec('small'), catalog)
    expect(monthlyTotal(q, 2999, 0.18)).toEqual({ planFee: 2999, infra: q.inrMonth, gstOnInfra: Math.round(q.inrMonth * 18) / 100, total: Math.round((2999 + q.inrMonth * 1.18) * 100) / 100 })
    expect(chargeFor(q.inrHour, 10)).toBeCloseTo((q.inrMonth / 730) * 10, 1)
  })

  it('refuses a server it has no price for', () => {
    expect(() => quoteSpec({ ...presetSpec('small'), node: { placement: 'dedicated', type: 'x9.huge', count: 1 } }, catalog)).toThrow(/No price/)
  })
})

describe('validateSpec', () => {
  it('accepts every preset on a plan that allows it', () => {
    expect(validateSpec(presetSpec('shared'), catalog, starter).ok).toBe(true)
    expect(validateSpec(presetSpec('small'), catalog, growth).errors).toEqual([])
    for (const k of ['medium', 'large', 'xlarge'] as const) expect(validateSpec(presetSpec(k), catalog, pro).errors).toEqual([])
  })

  it('fits storefront and admin on Small, but not the Pro business portal or a third storefront copy', () => {
    expect(validateSpec(presetSpec('small'), catalog, pro).errors.join(' ')).toMatch(/memory/)
    const s = presetSpec('small')
    s.services.storefront.maxReplicas = 3
    expect(validateSpec(s, catalog, growth).errors.join(' ')).toMatch(/memory/)
  })

  it('keeps Starter on the shared preset and paid plans on their own servers', () => {
    expect(planCompatibilityError(presetSpec('small'), starter)).toMatch(/shared servers/)
    expect(planCompatibilityError(presetSpec('shared'), pro)).toMatch(/own server/)
    const custom = presetSpec('small')
    custom.services.storefront.replicas = 2
    custom.services.storefront.maxReplicas = 2
    expect(planCompatibilityError(custom, presetsOnly)).toMatch(/higher plan/)
    expect(planCompatibilityError(custom, pro)).toBeNull()
  })

  it('suggests a bigger server when the copies do not fit', () => {
    const s = presetSpec('small')
    s.services.storefront = { replicas: 3, maxReplicas: 4, size: 'L' }
    const v = validateSpec(s, catalog, pro)
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/memory/)
    expect(smallestFittingNode(s, catalog)).toBe('t4g.large')
  })

  it('caps copies by the database connections', () => {
    const s = presetSpec('small')
    s.node.type = 't4g.xlarge'
    s.services.storefront = { replicas: 2, maxReplicas: 10, size: 'S' }
    s.services.messaging = { replicas: 2, maxReplicas: 6, size: 'S' }
    expect(validateSpec(s, catalog, pro).errors.join(' ')).toMatch(/connections/)
  })

  it('only lets database storage grow', () => {
    const current = presetSpec('small')
    current.db.storageGb = 50
    expect(validateSpec(presetSpec('small'), catalog, pro, { current }).errors).toEqual(['Database storage can only grow (it is 50 GB now).'])
  })
})

describe('presetOf', () => {
  it('recognises a preset whatever order its keys were stored in, with or without high availability', () => {
    const fromJsonb = JSON.parse(JSON.stringify({ services: presetSpec('medium').services, db: presetSpec('medium').db, node: presetSpec('medium').node }))
    expect(presetOf(fromJsonb)).toBe('medium')
    expect(presetOf(withHighAvailability(presetSpec('medium')))).toBe('medium')
    expect(presetOf({ ...presetSpec('medium'), db: { ...presetSpec('medium').db, storageGb: 30 } })).toBe('custom')
  })
})
