import { describe, it, expect } from 'vitest'
import { quoteSpec, monthlyTotal, chargeFor, marginFor, pausedInrHour } from '@controller/lib/compute/pricing'
import { PRESETS, presetOf, presetSpec, withDedicatedDb, withHighAvailability } from '@/lib/compute/presets'
import { validateSpec, smallestFittingNode, planCompatibilityError, fitOf, fittingServers } from '@/lib/compute/validate'
import type { Catalog, PlanCompute, PriceRow } from '@/lib/compute/spec'

// The seeded prices (controller-service/database/seeds/seed-plans.sql) and default settings.
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
    ebsGp3UsdGbMonth: 0.08,
    snapshotUsdGbMonth: 0.05,
  },
}
const starter: PlanCompute = { slug: 'starter', defaultPreset: 'shared', minPlacement: 'pool', advanced: false }
const pro: PlanCompute = { slug: 'pro', defaultPreset: 'medium', minPlacement: 'dedicated', advanced: true }
const presetsOnly: PlanCompute = { ...pro, advanced: false }
const growth: PlanCompute = { slug: 'growth', defaultPreset: 'small', minPlacement: 'dedicated', advanced: true }

describe('quoteSpec', () => {
  it('prices each preset as AWS cost × rate × (1 + margin)', () => {
    const month = (k: keyof typeof PRESETS) => Math.round(quoteSpec(presetSpec(k), catalog).inrMonth)
    expect([month('shared'), month('small'), month('medium'), month('large'), month('xlarge')]).toEqual([1496, 2141, 3490, 6617, 12728])
    const small = quoteSpec(presetSpec('small'), catalog)
    expect(Math.round(small.awsInrMonth)).toBe(1713)
    expect(small.inrDay).toBeCloseTo(70.39, 1)
    expect(small.marginInrMonth).toBeCloseTo(small.inrMonth - small.awsInrMonth, 1)
    expect(small.lines.map(l => l.key)).toEqual(['node', 'db:disk', 'db:snapshot', 'platform'])
  })

  it('doubles the database for a standby and adds a second server for high availability', () => {
    const large = presetSpec('large')
    large.db = { mode: 'dedicated', class: 'db.t4g.large', storageGb: 50, multiAz: false }
    expect(Math.round(quoteSpec(withHighAvailability(large), catalog).inrMonth)).toBe(33457)
  })

  it('adds GST on servers to the plan fee, and bills by the hour', () => {
    const q = quoteSpec(presetSpec('small'), catalog)
    expect(monthlyTotal(q, 2999, 0.18)).toEqual({ planFee: 2999, infra: q.inrMonth, gstOnInfra: Math.round(q.inrMonth * 18) / 100, total: Math.round((2999 + q.inrMonth * 1.18) * 100) / 100 })
    expect(chargeFor(q.inrHour, 10)).toBeCloseTo((q.inrMonth / 730) * 10, 1)
  })

  it("prices with the plan's RDS margin when the database is on RDS, else its server margin", () => {
    const node = presetSpec('basic')
    const rds = withDedicatedDb(presetSpec('basic'), 'basic')
    const basic = { infraMargin: 0, rdsMargin: 0.2 }
    expect(marginFor(basic, node)).toBe(0)
    expect(marginFor(basic, rds)).toBe(0.2)
    expect(marginFor({ infraMargin: 0.2 }, rds)).toBe(0.2)
    expect(marginFor(undefined, rds, 0.25)).toBe(0.25)
    const q = quoteSpec(rds, catalog, basic)
    expect(q.inrMonth).toBeCloseTo(q.awsInrMonth * 1.2, 1)
    expect(quoteSpec(node, catalog, basic).marginInrMonth).toBeCloseTo(0, 2)
    expect(pausedInrHour(rds, catalog, basic)).toBeCloseTo(pausedInrHour(rds, catalog, { infraMargin: 0.2 }), 4)
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

  it('clears the plan floor for node-default presets, and rejects one below it', () => {
    // presets default to node-Postgres; the floor rank must come from the server tier, not be forced
    // to 0 by db.mode==='node' (which would block every paid plan's own default spec).
    const growF: PlanCompute = { ...growth, minPreset: 'small' }
    const proF: PlanCompute = { ...pro, minPreset: 'medium' }
    const entF: PlanCompute = { slug: 'enterprise', defaultPreset: 'large', minPlacement: 'dedicated', minPreset: 'large', advanced: true }
    expect(planCompatibilityError(presetSpec('small'), growF)).toBeNull()
    expect(planCompatibilityError(presetSpec('medium'), proF)).toBeNull()
    expect(planCompatibilityError(presetSpec('large'), entF)).toBeNull()
    expect(planCompatibilityError(presetSpec('small'), proF)).toMatch(/minimum \(medium\)/)
  })

  it('fits storefront and admin on Small, but not the Pro business portal or a third storefront copy', () => {
    expect(validateSpec(presetSpec('small'), catalog, pro).errors.join(' ')).toMatch(/memory/)
    const s = presetSpec('small')
    s.services.storefront.maxReplicas = 3
    expect(validateSpec(s, catalog, growth).errors.join(' ')).toMatch(/memory/)
  })

  it('lets Basic keep its fixed server with its database on the server or a small RDS', () => {
    const basic: PlanCompute = { slug: 'basic', defaultPreset: 'basic', minPlacement: 'dedicated', minPreset: 'basic', advanced: true }
    const rds = withDedicatedDb(presetSpec('basic'), 'basic')
    expect(rds.db).toEqual({ mode: 'dedicated', class: 'db.t4g.micro', storageGb: 20, multiAz: false })
    expect(validateSpec(presetSpec('basic'), catalog, basic).errors).toEqual([])
    expect(validateSpec(rds, catalog, basic).errors).toEqual([])
    expect(planCompatibilityError({ ...rds, db: { ...rds.db, class: 'db.t4g.small' } }, basic)).toBeNull()
    expect(planCompatibilityError({ ...rds, db: { ...rds.db, class: 'db.t4g.large' } }, basic)).toMatch(/db.t4g.micro or db.t4g.small/)
    expect(planCompatibilityError({ ...rds, db: { ...rds.db, multiAz: true } }, basic)).toMatch(/standby/)
    expect(planCompatibilityError({ ...rds, db: { ...rds.db, storageGb: 10 } }, basic)).toMatch(/20 GB/)
    expect(planCompatibilityError({ ...rds, node: { ...rds.node, type: 't4g.medium' } }, basic)).toMatch(/fixed Basic/)
  })

  it("counts the server's Postgres, but lets the platform's own sizes through when only it tips them over", () => {
    const node = fitOf(presetSpec('basic'), catalog, 'basic')
    const rds = fitOf(withDedicatedDb(presetSpec('basic'), 'basic'), catalog, 'basic')
    expect(node.memory.requestedMib - rds.memory.requestedMib).toBe(256)
    expect(node.cpu.requestedMilli - rds.cpu.requestedMilli).toBe(100)
    // 1720 of 1598 MB at a release on t4g.small: Basic and Small stay valid, one more copy does not.
    expect(node.memory.requestedMib).toBeGreaterThan(node.memory.allocatableMib)
    expect(validateSpec(presetSpec('small'), catalog, growth).errors).toEqual([])
    const s = presetSpec('small')
    s.services.messaging.replicas = 2
    s.services.messaging.maxReplicas = 2
    expect(validateSpec(s, catalog, growth).errors.join(' ')).toMatch(/memory/)
  })

  it('adds servers when no single server type fits, and finds none when even the most of the largest do not', () => {
    const s = presetSpec('small')
    for (const k of ['storefront', 'admin', 'messaging', 'documents'] as const) s.services[k] = { replicas: 6, maxReplicas: 8, size: 'L' }
    expect(smallestFittingNode(s, catalog, 'growth')).toBeNull()
    expect(fittingServers(s, catalog, 'growth')).toEqual({ type: 't4g.xlarge', count: 2 })
    const smallOnly = { ...catalog, prices: catalog.prices.filter(p => p.code !== 'ec2:t4g.large' && p.code !== 'ec2:t4g.xlarge') }
    expect(fittingServers(s, smallOnly, 'growth')).toBeNull()
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
    // On the server Postgres allows 100 (90 for the store): ample for these copies; a micro RDS (40) is not.
    expect(validateSpec(s, catalog, pro).errors.join(' ')).not.toMatch(/connections/)
    s.db = { mode: 'dedicated', class: 'db.t4g.micro', storageGb: 20, multiAz: false }
    expect(validateSpec(s, catalog, pro).errors.join(' ')).toMatch(/connections.*bigger database/)
    s.db = presetSpec('small').db
    for (const k of ['storefront', 'admin', 'business', 'messaging'] as const) s.services[k] = { replicas: 1, maxReplicas: 10, size: 'S' }
    expect(validateSpec(s, catalog, pro).errors.join(' ')).toMatch(/database on your server allows 90 connections.*dedicated database/)
  })

  it('only lets database storage grow', () => {
    // Storage-grow is an RDS (dedicated) rule; use a dedicated spec so the check runs.
    const dedicated = (storageGb: number) => {
      const s = presetSpec('small')
      s.node.type = 't4g.medium'
      s.db = { mode: 'dedicated', class: 'db.t4g.small', storageGb, multiAz: false }
      return s
    }
    const current = dedicated(50)
    expect(validateSpec(dedicated(20), catalog, pro, { current }).errors).toEqual(['Database storage can only grow (it is 50 GB now).'])
  })
})

describe('presetOf', () => {
  it('recognises a preset whatever order its keys were stored in, with or without high availability', () => {
    const fromJsonb = JSON.parse(JSON.stringify({ services: presetSpec('medium').services, db: presetSpec('medium').db, node: presetSpec('medium').node, storage: presetSpec('medium').storage }))
    expect(presetOf(fromJsonb)).toBe('medium')
    expect(presetOf(withHighAvailability(presetSpec('medium')))).toBe('medium')
    expect(presetOf({ ...presetSpec('medium'), db: { ...presetSpec('medium').db, storageGb: 30 } })).toBe('custom')
  })
})
