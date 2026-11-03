import 'server-only'
import { listTenants, type TenantListRow } from '@/lib/tenant-registry/tenants'
import { purgeBlocker } from '@/lib/tenant-registry/purge-rule'
import { costsFor, type StoreCost } from './cost'
import { getFleet, type Fleet, type TenantFleet } from './fleet'

// One row per customer for the Ecom Store lists: the tenant, what it runs now (fleet) and what it costs.

export interface EcomRow extends TenantListRow {
  isStore: boolean
  cost: StoreCost
  /** null when the fleet can't be read (outside the cluster) or the store runs nothing. */
  fleet: TenantFleet | null
  /** Running EC2 servers dedicated to it; null when the fleet is unknown. */
  serversRunning: number | null
  /** Delete is offered (purgeBlocker): terminated, rejected or rolled back, with no database and nothing running. */
  purgeable: boolean
}

export interface EcomTotals {
  total: number
  active: number
  provisioning: number
  review: number
  inactive: number
  mrr: number
  awsMonth: number
  marginMonth: number
  mtd: number
  gmv30: number
  commission30: number
  /** null when the fleet can't be read. */
  serversRunning: number | null
  podsReady: number | null
  podsTotal: number | null
}

export const isStoreRow = (t: { service_types: string[] | null }) => (t.service_types ?? ['store']).includes('store')

export const isPurgeable = (t: { id: string; status: string; rds_endpoint: string | null; ec2_instance_id?: string | null }, serversRunning: number | null) =>
  purgeBlocker(t, serversRunning ?? 0) === null

const running = (f: TenantFleet | undefined) => (f ? f.servers.filter(s => s.state === 'running' || s.state === 'pending').length : 0)

export async function loadEcomRows(filters?: Parameters<typeof listTenants>[0]): Promise<{ rows: EcomRow[]; fleet: Fleet | null; totals: EcomTotals }> {
  const [list, fleet] = await Promise.all([listTenants(filters), getFleet()])
  const costs = await costsFor(list)
  const rows = list.map((t): EcomRow => {
    const f = fleet?.tenants[t.slug]
    const serversRunning = fleet ? running(f) : null
    return { ...t, isStore: isStoreRow(t), cost: costs[t.id], fleet: f ?? null, serversRunning, purgeable: isPurgeable(t, serversRunning) }
  })
  return { rows, fleet, totals: ecomTotals(rows, fleet) }
}

// Same as tenantSummary: stored price, else plan fee; yearly billing charges ten months a year.
const monthlyValue = (r: EcomRow) =>
  (Number(r.price_inr_month ?? r.monthly_price_inr) || 0) * (r.billing_interval === 'yearly' ? 10 / 12 : 1)

const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((s, x) => s + (Number(x) || 0), 0)

export function ecomTotals(rows: EcomRow[], fleet: Fleet | null): EcomTotals {
  const live = rows.filter(r => r.status === 'active' || r.status === 'provisioning')
  return {
    total: rows.length,
    active: rows.filter(r => r.status === 'active').length,
    provisioning: rows.filter(r => r.status === 'provisioning').length,
    review: rows.filter(r => r.needs_review).length,
    inactive: rows.filter(r => r.status !== 'active').length,
    mrr: sum(rows.filter(r => r.status === 'active').map(monthlyValue)),
    awsMonth: sum(live.map(r => r.cost.awsMonth)),
    marginMonth: sum(live.map(r => r.cost.marginMonth)),
    mtd: sum(rows.map(r => r.cost.mtdEstimate)),
    gmv30: sum(rows.map(r => r.gmv_30d)),
    commission30: sum(rows.map(r => r.commission_30d)),
    serversRunning: fleet ? sum(rows.map(r => r.serversRunning)) : null,
    podsReady: fleet ? sum(rows.map(r => r.fleet?.pods.ready)) : null,
    podsTotal: fleet ? sum(rows.map(r => r.fleet?.pods.total)) : null,
  }
}
