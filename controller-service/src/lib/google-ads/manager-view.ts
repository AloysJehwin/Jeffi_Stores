import { controlPlanePool, deleteIntegrationCredential } from '@/lib/tenant-registry'
import { GoogleAdsApiError, normalizeCustomerId, type AdsRow, type GoogleAdsClient } from '@/lib/google-ads/client'
import { GOOGLE_ADS_PROVIDER } from '@/lib/google-ads/credentials'

// The platform manager account's view for platform admins: every client account under the Jeffi
// manager (customer_client), which store it belongs to (tenant_integration_credentials), its
// status and last-30-day spend (one read per client; Google has no cross-account metrics), and
// unlinking a client (CustomerClientLinkService: ACTIVE -> INACTIVE, PENDING -> CANCELED).

export const Q_MANAGED_CLIENTS = `SELECT customer_client.id, customer_client.descriptive_name, customer_client.status, customer_client.manager,
   customer_client.level, customer_client.currency_code, customer_client.test_account, customer_client.hidden
 FROM customer_client WHERE customer_client.level = 1`

export const Q_CLIENT_LINKS = `SELECT customer_client_link.resource_name, customer_client_link.client_customer, customer_client_link.status
 FROM customer_client_link WHERE customer_client_link.status IN ('ACTIVE', 'PENDING')`

export const Q_SPEND_30D = `SELECT metrics.cost_micros, metrics.clicks, metrics.conversions FROM customer WHERE segments.date DURING LAST_30_DAYS`

const MAX_CLIENTS = 200
const SPEND_CONCURRENCY = 5

export interface StoreRef {
  tenantId: string
  name: string
  slug: string | null
  connectedVia: string | null
}

export interface ManagedAccount {
  customerId: string
  name: string | null
  status: string | null
  linkStatus: string | null
  currency: string | null
  testAccount: boolean
  stores: StoreRef[]
  spend30d: number | null
  clicks30d: number | null
  conversions30d: number | null
  spendError: string | null
}

/** Stores keyed by the Google Ads customer id they are connected to. */
export async function storesByCustomer(): Promise<Map<string, StoreRef[]>> {
  const r = await controlPlanePool().query(
    `SELECT c.tenant_id, c.meta, t.display_name, t.slug FROM tenant_integration_credentials c
     JOIN tenants t ON t.id = c.tenant_id WHERE c.provider = $1 AND c.status = 'connected'`,
    [GOOGLE_ADS_PROVIDER]
  )
  const out = new Map<string, StoreRef[]>()
  for (const row of r.rows) {
    const cid = normalizeCustomerId(row.meta?.customer_id)
    if (!cid) continue
    out.set(cid, [
      ...(out.get(cid) ?? []),
      { tenantId: String(row.tenant_id), name: row.display_name, slug: row.slug ?? null, connectedVia: row.meta?.connected_via ?? null },
    ])
  }
  return out
}

export function mapManagedAccounts(
  clients: AdsRow[],
  links: AdsRow[],
  stores: Map<string, StoreRef[]>,
  spend: Map<string, { cost: number; clicks: number; conversions: number } | { error: string }>
): ManagedAccount[] {
  const linkStatus = new Map<string, string>()
  for (const l of links) {
    const id = normalizeCustomerId(String(l.customerClientLink?.clientCustomer ?? '').split('/').pop())
    if (id) linkStatus.set(id, l.customerClientLink?.status ?? null)
  }
  const accounts = new Map<string, ManagedAccount>()
  const add = (id: string, a: Partial<ManagedAccount>) => {
    const s = spend.get(id)
    accounts.set(id, {
      customerId: id,
      name: null,
      status: null,
      currency: null,
      testAccount: false,
      linkStatus: linkStatus.get(id) ?? null,
      stores: stores.get(id) ?? [],
      spend30d: s && 'cost' in s ? s.cost : null,
      clicks30d: s && 'cost' in s ? s.clicks : null,
      conversions30d: s && 'cost' in s ? s.conversions : null,
      spendError: s && 'error' in s ? s.error : null,
      ...a,
    })
  }
  for (const row of clients) {
    const c = row.customerClient ?? {}
    const id = normalizeCustomerId(c.id)
    if (!id || c.manager) continue
    add(id, { name: c.descriptiveName ?? null, status: c.status ?? null, currency: c.currencyCode ?? null, testAccount: !!c.testAccount })
  }
  // Invitations not yet accepted are links without a customer_client row.
  for (const [id, status] of linkStatus) if (!accounts.has(id) && status === 'PENDING') add(id, { status: 'INVITED' })
  return [...accounts.values()].sort((a, b) => (b.spend30d ?? -1) - (a.spend30d ?? -1) || (a.name ?? '').localeCompare(b.name ?? ''))
}

async function spendFor(mgr: GoogleAdsClient, ids: string[]) {
  const out = new Map<string, { cost: number; clicks: number; conversions: number } | { error: string }>()
  const queue = [...ids]
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        const rows = await mgr.forCustomer(id, mgr.customerId).searchStream(Q_SPEND_30D)
        const sum = (f: string) => rows.reduce((s, r) => s + (Number(r.metrics?.[f] ?? 0) || 0), 0)
        out.set(id, { cost: sum('costMicros') / 1e6, clicks: sum('clicks'), conversions: sum('conversions') })
      } catch (e) {
        out.set(id, { error: e instanceof GoogleAdsApiError ? e.message : String((e as any)?.message ?? e) })
      }
    }
  }
  await Promise.all(Array.from({ length: SPEND_CONCURRENCY }, worker))
  return out
}

export async function listManagedAccounts(mgr: GoogleAdsClient): Promise<{ managerId: string; accounts: ManagedAccount[] }> {
  const [clients, links, stores] = await Promise.all([mgr.searchStream(Q_MANAGED_CLIENTS), mgr.searchStream(Q_CLIENT_LINKS), storesByCustomer()])
  const enabled = clients
    .map(r => r.customerClient ?? {})
    .filter(c => !c.manager && c.status === 'ENABLED')
    .map(c => normalizeCustomerId(c.id))
    .filter(Boolean)
    .slice(0, MAX_CLIENTS)
  const spend = await spendFor(mgr, enabled)
  return { managerId: mgr.customerId, accounts: mapManagedAccounts(clients, links, stores, spend) }
}

/**
 * End the manager link (or withdraw a pending invitation), validated first, then disconnect any
 * store that reached the account through the manager. The account itself and its data stay.
 */
export async function unlinkManagedAccount(mgr: GoogleAdsClient, customerId: string): Promise<{ disconnected: StoreRef[] }> {
  const cid = normalizeCustomerId(customerId)
  if (!/^\d{10}$/.test(cid)) throw new Error('Invalid customer id')
  const rows = await mgr.searchStream(
    `SELECT customer_client_link.resource_name, customer_client_link.status FROM customer_client_link
     WHERE customer_client_link.client_customer = 'customers/${cid}' AND customer_client_link.status IN ('ACTIVE', 'PENDING')`
  )
  const link = rows[0]?.customerClientLink
  if (!link?.resourceName) throw new Error('This account is not linked to the platform manager.')
  const body = { operation: { update: { resourceName: link.resourceName, status: link.status === 'PENDING' ? 'CANCELED' : 'INACTIVE' }, updateMask: 'status' } }
  await mgr.post('/customerClientLinks:mutate', { ...body, validateOnly: true })
  await mgr.withRetryDelays([]).post('/customerClientLinks:mutate', body)
  const stores = ((await storesByCustomer()).get(cid) ?? []).filter(s => s.connectedVia === 'manager')
  for (const s of stores) await deleteIntegrationCredential(s.tenantId, GOOGLE_ADS_PROVIDER)
  return { disconnected: stores }
}
