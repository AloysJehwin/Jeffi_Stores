import 'server-only'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import {
  getKyc,
  getProvisioningJob,
  getTenant,
  hasService,
  listCustomDomains,
  listServiceApprovals,
  listTenants,
  type CustomDomain,
  type ProvisioningJob,
  type ServiceApproval,
  type TenantDetail,
  type TenantKyc,
  type TenantListRow,
} from '@/lib/tenant-registry'
import { normalizeSpec, type ComputeSpec } from '@/lib/compute/spec'
import type { TenantWorkloadStatus } from '@/lib/k8s/tenant-compute'
import { DEFAULT_SETTINGS, computePlans, getCatalog } from '@controller/lib/compute/catalog'
import { marginFor, monthlyTotal, quoteSpec, type Quote } from '@controller/lib/compute/pricing'
import { getTenantCompute, type TenantCompute } from '@controller/lib/compute/store'
import { getTenantMigrationRuns, type TenantMigrationRun } from '@controller/lib/tenant-migrations'
import { costsFor, type StoreCost } from './cost'
import { getFleet, type TenantFleet } from './fleet'
import { isPurgeable } from './rows'

// Everything the four tenant detail pages (Store, Instance, Status, Billing) share: one loader, one header.

export interface TenantDetailData {
  t: TenantDetail
  isStore: boolean
  job: ProvisioningJob | null
  kyc: TenantKyc | null
  approvals: ServiceApproval[]
  /** Store KYC or a requested Messaging/Documents service is waiting on Jeffi. */
  kycPending: boolean
  /** The tenant's listTenants row: applied spec, subscription price, wallet, S3 usage, owner, 30-day sales. */
  row: TenantListRow | null
  cost: StoreCost
  /** False outside the cluster (local dev): servers and pods are unknown, not absent. */
  fleetKnown: boolean
  fleet: TenantFleet | null
  /** Running (or starting) servers dedicated to it; null when the fleet is unknown. */
  serversRunning: number | null
  purgeable: boolean
}

const NO_COST: StoreCost = { priceMonth: null, priceHour: null, awsMonth: null, marginMonth: null, mtdEstimate: null }

/** Platform admins only (x-user-role); 404 for an unknown id. */
export async function loadTenantDetail(id: string): Promise<TenantDetailData> {
  if (!isPlatformAdmin((await headers()).get('x-user-role') || '')) redirect('/admin')
  const t = await getTenant(id)
  if (!t) notFound()

  const [job, kyc, approvals, fleetAll, row] = await Promise.all([
    getProvisioningJob(id).catch(() => null),
    getKyc(id).catch(() => null),
    listServiceApprovals(id).catch(() => [] as ServiceApproval[]),
    getFleet(),
    listTenants({ q: t.slug })
      .then(rows => rows.find(r => r.id === id) ?? null)
      .catch(() => null),
  ])
  const cost = row ? ((await costsFor([row]))[id] ?? NO_COST) : NO_COST
  const fleet = fleetAll?.tenants[t.slug] ?? null
  const serversRunning = fleetAll ? (fleet?.servers.filter(s => s.state === 'running' || s.state === 'pending').length ?? 0) : null

  return {
    t,
    isStore: hasService(t, 'store'),
    job,
    kyc,
    approvals,
    kycPending: kyc?.status === 'pending' || approvals.some(a => a.status === 'pending'),
    row,
    cost,
    fleetKnown: !!fleetAll,
    fleet,
    serversRunning,
    purgeable: isPurgeable(t, serversRunning),
  }
}

export interface CostBreakdown {
  quote: Quote
  usdInr: number
  margin: number
  planFee: number
  total: ReturnType<typeof monthlyTotal>
}

export interface InfraDetail {
  domains: CustomDomain[]
  migrations: TenantMigrationRun[]
  currentSha: string | null
  compute: TenantCompute | null
  /** The applied spec (what runs), else the chosen one while it is being applied. */
  spec: ComputeSpec | null
  /** null: no app Deployment; undefined: the cluster could not be read. */
  workload: TenantWorkloadStatus | null | undefined
  breakdown: CostBreakdown | null
  /** Why there is no breakdown (no spec yet, or a part without a price). */
  breakdownNote: string | null
}

/** The Instance page and the Infrastructure tab: domains, schema runs, compute row, live workload and the priced spec. */
export async function loadInfraDetail(d: TenantDetailData): Promise<InfraDetail> {
  const { t } = d
  const [domains, migrations, compute, workload, catalog, plans] = await Promise.all([
    listCustomDomains(t.id).catch(() => [] as CustomDomain[]),
    getTenantMigrationRuns(t.id).catch(() => [] as TenantMigrationRun[]),
    getTenantCompute(t.id).catch(() => null),
    d.isStore ? import('@/lib/k8s/tenant-compute').then(m => m.getTenantWorkloadStatus(t.slug)).catch(() => undefined) : Promise.resolve(null),
    getCatalog().catch(() => ({ prices: [], settings: DEFAULT_SETTINGS })),
    computePlans({ includeInactive: true }).catch(() => []),
  ])
  const raw = compute?.applied ?? d.row?.applied ?? null
  const spec = raw ? normalizeSpec(raw) : (compute?.desired ?? null)

  let breakdown: CostBreakdown | null = null
  let breakdownNote: string | null = spec ? null : 'No compute has been applied to this store yet.'
  if (spec) {
    const plan = plans.find(p => p.slug === t.plan)
    const margin = marginFor(plan, spec, catalog.settings.margin ?? 0)
    try {
      const quote = quoteSpec(spec, catalog, { infraMargin: margin })
      const planFee = plan?.monthlyPriceInr ?? 0
      breakdown = { quote, usdInr: catalog.settings.usdInr, margin, planFee, total: monthlyTotal(quote, planFee, catalog.settings.gstRate) }
    } catch (e) {
      breakdownNote = (e as Error)?.message || 'A part of this spec has no price in the catalog.'
    }
  }
  return { domains, migrations, currentSha: process.env.GIT_SHA || null, compute, spec, workload, breakdown, breakdownNote }
}

export const DETAIL_PAGE_SIZE = 10

/** 1-based page from a ?param. */
export const pageParam = (v: string | undefined) => Math.max(1, Math.floor(Number(v) || 1))
