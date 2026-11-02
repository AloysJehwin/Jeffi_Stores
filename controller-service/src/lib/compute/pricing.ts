import { HOURS_PER_MONTH, ec2Code, priceOf, rdsCode, type Catalog, type ComputeSpec } from '@/lib/compute/spec'

// What a store's compute costs: AWS on-demand price × USD→INR × (1 + margin), per month and per hour.
// GST is not in these figures: it is charged on wallet top-ups (and is inside the plan fee).

export interface QuoteLine {
  key: string
  label: string
  detail: string
  awsUsdMonth: number
  inrMonth: number
}

export interface Quote {
  lines: QuoteLine[]
  awsUsdMonth: number
  awsInrMonth: number
  inrMonth: number
  inrDay: number
  inrHour: number
  marginInrMonth: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export class UnknownPriceError extends Error {}

function hourly(catalog: Catalog, code: string, multiAz = false): number {
  const p = priceOf(catalog, code)
  const v = multiAz ? p?.usdHourlyMultiAz : p?.usdHourly
  if (v == null) throw new UnknownPriceError(`No price for ${code}${multiAz ? ' (Multi-AZ)' : ''}`)
  return v
}

function perGb(catalog: Catalog, code: string, multiAz = false): number {
  const p = priceOf(catalog, code)
  const v = multiAz ? (p?.usdGbMonthMultiAz ?? (p?.usdGbMonth != null ? p.usdGbMonth * 2 : null)) : p?.usdGbMonth
  if (v == null) throw new UnknownPriceError(`No price for ${code}`)
  return v
}

export function quoteSpec(spec: ComputeSpec, catalog: Catalog, plan?: { infraMargin?: number }): Quote {
  const s = catalog.settings
  // Margin resolution: per-plan markup wins, else the catalog's global setting, else 0.
  const margin = plan?.infraMargin ?? s.margin ?? 0
  const toInr = (usd: number) => usd * s.usdInr * (1 + margin)
  const raw: Omit<QuoteLine, 'inrMonth'>[] = []
  const disk = s.rootVolumeGb * perGb(catalog, 'ebs:gp3')

  if (spec.node.placement === 'pool') {
    const node = hourly(catalog, ec2Code(s.poolNodeType)) * HOURS_PER_MONTH + disk
    raw.push({ key: 'node', label: 'Server', detail: `Share of a ${s.poolNodeType} with ${s.poolCapacity - 1} other stores`, awsUsdMonth: node / s.poolCapacity })
  } else {
    const type = spec.node.type ?? ''
    const node = hourly(catalog, ec2Code(type)) * HOURS_PER_MONTH + disk
    const n = spec.node.count
    raw.push({ key: 'node', label: n > 1 ? `Servers (${n})` : 'Server', detail: `${n} × ${type}, ${s.rootVolumeGb} GB disk`, awsUsdMonth: node * n })
  }

  if (spec.db.mode === 'shared') {
    const host = hourly(catalog, rdsCode(s.sharedDbClass)) * HOURS_PER_MONTH
    raw.push({ key: 'db', label: 'Database', detail: `Share of a ${s.sharedDbClass} with ${s.sharedDbCapacity - 1} other stores`, awsUsdMonth: host / s.sharedDbCapacity })
    raw.push({ key: 'storage', label: 'Database storage', detail: `${s.sharedDbStorageGb} GB`, awsUsdMonth: s.sharedDbStorageGb * perGb(catalog, 'rds_storage:gp3') })
  } else if (spec.db.mode === 'node') {
    // Postgres runs on the EC2 node itself (Basic). Disk + snapshot are billed separately.
    const ebs = s.ebsGp3UsdGbMonth ?? 0
    const snap = s.snapshotUsdGbMonth ?? 0
    if (spec.db.storageGb > 0 && ebs > 0) {
      raw.push({ key: 'db:disk', label: 'Database disk', detail: `${spec.db.storageGb} GB`, awsUsdMonth: spec.db.storageGb * ebs })
    }
    if (spec.db.storageGb > 0 && snap > 0) {
      raw.push({ key: 'db:snapshot', label: 'Database snapshots', detail: `${spec.db.storageGb} GB`, awsUsdMonth: spec.db.storageGb * snap })
    }
  } else {
    const cls = spec.db.class ?? ''
    const az = spec.db.multiAz
    raw.push({
      key: 'db',
      label: 'Database',
      detail: `${cls}${az ? ', standby in a second zone' : ''}`,
      awsUsdMonth: hourly(catalog, rdsCode(cls), az) * HOURS_PER_MONTH,
    })
    raw.push({ key: 'storage', label: 'Database storage', detail: `${spec.db.storageGb} GB`, awsUsdMonth: spec.db.storageGb * perGb(catalog, 'rds_storage:gp3', az) })
  }

  // One public IPv4 per node (AWS now charges for every attached IPv4).
  const ipv4Rate = s.ipv4UsdHour ?? 0
  if (ipv4Rate > 0 && spec.node.count > 0) {
    const n = spec.node.count
    raw.push({ key: 'ipv4', label: n > 1 ? `IPv4 (${n})` : 'IPv4', detail: `${n} × public IPv4`, awsUsdMonth: n * ipv4Rate * HOURS_PER_MONTH })
  }

  // S3 bucket for backups and media.
  const s3Rate = s.s3UsdGbMonth ?? 0
  const s3Gb = spec.storage?.s3Gb ?? 0
  if (s3Rate > 0 && s3Gb > 0) {
    raw.push({ key: 's3', label: 'Object storage', detail: `${s3Gb} GB in S3`, awsUsdMonth: s3Gb * s3Rate })
  }

  raw.push({ key: 'platform', label: 'Platform', detail: 'Bandwidth and monitoring', awsUsdMonth: s.platformShareUsd })

  const lines = raw.map(l => ({ ...l, awsUsdMonth: round2(l.awsUsdMonth), inrMonth: round2(toInr(l.awsUsdMonth)) }))
  const awsUsdMonth = raw.reduce((n, l) => n + l.awsUsdMonth, 0)
  const inrMonth = round2(toInr(awsUsdMonth))
  const inrHour = inrMonth / HOURS_PER_MONTH
  return {
    lines,
    awsUsdMonth: round2(awsUsdMonth),
    awsInrMonth: round2(awsUsdMonth * s.usdInr),
    inrMonth,
    inrDay: round2(inrHour * 24),
    inrHour: Math.round(inrHour * 10000) / 10000,
    marginInrMonth: round2(inrMonth - awsUsdMonth * s.usdInr),
  }
}

/**
 * The owner's monthly total: the plan fee (GST included) plus infrastructure with GST on top.
 * planFeeInr is the plan's monthly_price_inr (0 for margin-on-infra plans), passed by both the
 * MRR calculation and change-plan so grandfathered plans with a stored fee are billed correctly.
 */
export function monthlyTotal(quote: Quote, planFeeInr: number, gstRate: number) {
  const gst = round2(quote.inrMonth * gstRate)
  return { planFee: round2(planFeeInr), infra: quote.inrMonth, gstOnInfra: gst, total: round2(planFeeInr + quote.inrMonth + gst) }
}

/** While a store is paused for an unpaid wallet: its disks, database storage and the platform share, per hour. */
export function pausedInrHour(spec: ComputeSpec, catalog: Catalog): number {
  const s = catalog.settings
  const kept = quoteSpec(spec, catalog).lines.filter(l => l.key === 'storage' || l.key === 'platform').reduce((n, l) => n + l.awsUsdMonth, 0)
  const disks = spec.node.placement === 'pool' ? 0 : spec.node.count * s.rootVolumeGb * perGb(catalog, 'ebs:gp3')
  return Math.round((((kept + disks) * s.usdInr * (1 + s.margin)) / HOURS_PER_MONTH) * 10000) / 10000
}

/** Billing for part of a month: the spec's hourly rate × hours it ran. */
export const chargeFor = (inrHour: number, hours: number) => round2(inrHour * hours)
