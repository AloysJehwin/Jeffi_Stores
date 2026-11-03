import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const k8s = vi.hoisted(() => ({ inCluster: vi.fn(() => true), listAll: vi.fn(), list: vi.fn() }))
const ec2 = vi.hoisted(() => ({ describeTenantServers: vi.fn() }))
const tenants = vi.hoisted(() => ({ listTenants: vi.fn() }))
const cost = vi.hoisted(() => ({ costsFor: vi.fn() }))

vi.mock('@/lib/k8s/client', () => k8s)
vi.mock('@/lib/k8s/tenant-compute', () => ({
  isPostgres: (o: any) => o.metadata?.labels?.app === 'postgres',
  isReady: (n: any) => n.ready === true,
  onPool: (ns: any) => ns.metadata?.labels?.['jeffi.io/pool'] === 'basic',
  poolCapacity: () => 4,
}))
vi.mock('@/lib/shared/ec2-client', () => ec2)
vi.mock('@/lib/tenant-registry/tenants', () => tenants)
vi.mock('@controller/lib/ecom/cost', () => cost)

const server = (id: string, state = 'running') => ({ id, type: 't4g.medium', state, az: 'us-east-1a', launchedAt: null, name: id })
const pod = (tenant: string, ready: boolean, extra: any = {}) => ({
  metadata: { labels: { 'jeffi.io/tenant': tenant, ...(extra.labels ?? {}) }, deletionTimestamp: extra.deleting },
  status: { phase: extra.phase ?? 'Running', conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }] },
})

function cluster() {
  k8s.listAll.mockImplementation(async (kind: string) =>
    kind === 'Pod'
      ? [pod('alpha', true), pod('alpha', false), pod('alpha', true, { labels: { app: 'postgres' } }), pod('beta', true, { phase: 'Succeeded' }), pod('beta', true, { deleting: 'now' }), { metadata: {} }]
      : [
          { metadata: { namespace: 'tenant-alpha', name: 'storefront' }, status: { readyReplicas: 1 }, spec: { replicas: 2 } },
          { metadata: { namespace: 'tenant-alpha', name: 'postgres', labels: { app: 'postgres' } }, status: {}, spec: { replicas: 1 } },
          { metadata: { namespace: 'jeffi', name: 'controller' }, status: {}, spec: {} },
        ]
  )
  k8s.list.mockImplementation(async (kind: string) =>
    kind === 'Namespace'
      ? [{ metadata: { name: 'tenant-alpha', labels: { 'jeffi.io/tenant': 'alpha' } } }, { metadata: { name: 'tenant-beta', labels: { 'jeffi.io/pool': 'basic' } } }]
      : [{ metadata: { labels: { 'jeffi.io/pool': 'basic' } }, ready: true }, { metadata: { labels: { 'jeffi.io/pool': 'basic' } }, ready: false }, { metadata: { labels: {} } }]
  )
  ec2.describeTenantServers.mockResolvedValue({ byTenant: { alpha: [server('i-1'), server('i-2', 'stopped')] }, shared: [server('i-core')] })
}

describe('getFleet', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    k8s.inCluster.mockReturnValue(true)
  })

  it('is null outside the cluster without touching k8s or EC2', async () => {
    k8s.inCluster.mockReturnValue(false)
    const { getFleet } = await import('@controller/lib/ecom/fleet')
    expect(await getFleet()).toBeNull()
    expect(k8s.listAll).not.toHaveBeenCalled()
    expect(ec2.describeTenantServers).not.toHaveBeenCalled()
  })

  it('groups servers, pods and deployments per store and sizes the pool', async () => {
    cluster()
    const { getFleet } = await import('@controller/lib/ecom/fleet')
    const f = (await getFleet())!
    expect(f.tenants.alpha).toMatchObject({ placement: 'dedicated', pods: { ready: 2, total: 3 }, postgresReady: true })
    expect(f.tenants.alpha.servers.map(s => s.id)).toEqual(['i-1', 'i-2'])
    expect(f.tenants.alpha.deployments).toEqual([
      { name: 'storefront', ready: 1, desired: 2 },
      { name: 'postgres', ready: 0, desired: 1 },
    ])
    expect(f.tenants.beta).toMatchObject({ placement: 'pool', pods: { ready: 0, total: 0 } })
    expect(f.pool).toMatchObject({ nodes: 2, readyNodes: 1, capacity: 4, stores: 1 })
    expect(f.pool.servers.map(s => s.id)).toEqual(['i-core'])
    // Cached: a second read within 30 s doesn't hit the cluster again.
    await getFleet()
    expect(k8s.listAll).toHaveBeenCalledTimes(2)
  })

  it('is null (never throws) when the cluster or EC2 can not be read', async () => {
    cluster()
    ec2.describeTenantServers.mockRejectedValue(new Error('denied'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { getFleet } = await import('@controller/lib/ecom/fleet')
    expect(await getFleet()).toBeNull()
  })
})

const NO_COST = { priceMonth: null, priceHour: null, awsMonth: null, marginMonth: null, mtdEstimate: null }
const row = (o: Record<string, unknown>) => ({
  id: String(o.slug),
  slug: String(o.slug),
  status: 'active',
  service_types: ['store'],
  rds_endpoint: null,
  ec2_instance_id: null,
  price_inr_month: null,
  monthly_price_inr: null,
  billing_interval: 'monthly',
  needs_review: false,
  gmv_30d: 0,
  commission_30d: 0,
  ...o,
})

describe('loadEcomRows', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('joins the fleet and cost and totals what is live', async () => {
    k8s.inCluster.mockReturnValue(true)
    cluster()
    tenants.listTenants.mockResolvedValue([
      row({ slug: 'alpha', price_inr_month: 1200, gmv_30d: 500, commission_30d: 25 }),
      row({ slug: 'beta', monthly_price_inr: '1200', billing_interval: 'yearly', needs_review: true }),
      row({ slug: 'gone', status: 'terminated' }),
      row({ slug: 'live-db', status: 'terminated', rds_endpoint: 'db.local' }),
      row({ slug: 'api', service_types: ['messaging'], status: 'provisioning' }),
    ])
    cost.costsFor.mockResolvedValue({
      alpha: { ...NO_COST, awsMonth: 300, marginMonth: 700, mtdEstimate: 90 },
      beta: { ...NO_COST, awsMonth: 100, marginMonth: 50 },
      gone: NO_COST,
      'live-db': NO_COST,
      api: NO_COST,
    })
    const { loadEcomRows } = await import('@controller/lib/ecom/rows')
    const { rows, totals } = await loadEcomRows()
    const by = Object.fromEntries(rows.map(r => [r.slug, r]))
    expect(by.alpha).toMatchObject({ isStore: true, serversRunning: 1, purgeable: false })
    expect(by.gone.purgeable).toBe(true)
    expect(by['live-db'].purgeable).toBe(false)
    expect(by.api.isStore).toBe(false)
    expect(totals).toMatchObject({ total: 5, active: 2, provisioning: 1, review: 1, inactive: 3, mrr: 2200, awsMonth: 400, marginMonth: 750, mtd: 90, gmv30: 500, commission30: 25, serversRunning: 1, podsReady: 2, podsTotal: 3 })
  })

  it('leaves fleet totals unknown outside the cluster', async () => {
    k8s.inCluster.mockReturnValue(false)
    tenants.listTenants.mockResolvedValue([row({ slug: 'failed', status: 'suspended' })])
    cost.costsFor.mockResolvedValue({ failed: NO_COST })
    const { loadEcomRows } = await import('@controller/lib/ecom/rows')
    const { rows, fleet, totals } = await loadEcomRows()
    expect(fleet).toBeNull()
    expect(rows[0]).toMatchObject({ serversRunning: null, fleet: null, purgeable: true })
    expect(totals).toMatchObject({ serversRunning: null, podsReady: null, podsTotal: null })
  })
})

describe('ecom cells', () => {
  it('formats money, rates, sizes and dates', async () => {
    const c = await import('@controller/components/admin/ecom/cells')
    expect(c.inr(1234.5)).toBe('₹1,235')
    expect(c.inr(-3091)).toBe('−₹3,091')
    expect(c.inr(null)).toBe('—')
    expect(c.inr('x')).toBe('—')
    expect(c.inrHr(6.4712)).toBe('₹6.47/h')
    expect(c.inrHr(null)).toBe('—')
    expect(c.bytes(0)).toBe('—')
    expect(c.bytes(512)).toBe('512 B')
    expect(c.bytes(3 * 1024 ** 3)).toBe('3.0 GB')
    expect(c.dateIN(null)).toBe('—')
    expect(c.dateIN('2026-11-03T00:00:00Z')).toContain('2026')
    expect(c.dateTimeIN(undefined)).toBe('—')
    expect(c.dateTimeIN('2026-11-03T10:00:00Z')).toContain('Nov')
    expect(c.storeHost({ slug: 'alpha', custom_domain: 'shop.example.com, b.example.com' })).toBe('shop.example.com')
    expect(c.storeHost({ slug: 'alpha', custom_domain: null })).toBe('alpha.jeffistores.in')
  })

  it('renders the list cells', async () => {
    const c = await import('@controller/components/admin/ecom/cells')
    const html = (el: React.ReactElement) => renderToStaticMarkup(el)
    const fleet = { placement: 'dedicated' as const, servers: [server('i-1'), server('i-2')], pods: { ready: 6, total: 7 }, deployments: [], postgresReady: true }
    expect(html(<c.RunningCell fleet={null} known={false} servers={null} />)).toContain('—')
    expect(html(<c.RunningCell fleet={null} known servers={0} />)).toContain('Nothing running')
    expect(html(<c.RunningCell fleet={fleet} known servers={2} />)).toContain('2 servers · 6/7 pods')
    expect(html(<c.RunningCell fleet={{ ...fleet, placement: 'pool', pods: { ready: 3, total: 3 } }} known servers={0} />)).toContain('shared pool · 3/3 pods')
    expect(html(<c.CostCell price={2081} aws={1734} />)).toContain('AWS ₹1,734')
    expect(html(<c.CostCell price={null} aws={null} />)).toContain('—')
    expect(html(<c.SpendCell mtd={450} />)).toContain('₹450 est.')
    expect(html(<c.SpendCell mtd={null} />)).toContain('—')
    expect(html(<c.PlacementCell fleet={fleet} known />)).toContain('Own server')
    expect(html(<c.PlacementCell fleet={{ ...fleet, placement: 'pool' }} known />)).toContain('Shared pool')
    expect(html(<c.PlacementCell fleet={null} known />)).toContain('None')
    expect(html(<c.PlacementCell fleet={null} known={false} />)).toContain('—')
    expect(html(<c.ServersCell fleet={fleet} known />)).toContain('t4g.medium × 2 · running')
    expect(html(<c.ServersCell fleet={{ ...fleet, servers: [], placement: 'pool' }} known />)).toContain('Pool')
    expect(html(<c.ServersCell fleet={null} known={false} />)).toContain('—')
    expect(html(<c.StoreCell t={{ display_name: 'Alpha', slug: 'alpha', custom_domain: null, owner_email: 'o@crm.test', isStore: true, service_types: ['store'] }} />)).toContain('o@crm.test')
    expect(html(<c.StoreCell t={{ display_name: 'Api', slug: 'api', custom_domain: null, owner_email: null, isStore: false, service_types: ['messaging'] }} />)).toContain('API workspace · messaging')
    expect(html(<c.TenantStatus status="pending_approval" />)).toContain('Pending approval')
  })
})
