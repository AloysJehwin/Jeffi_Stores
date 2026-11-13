import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { controlPlanePool, getOwnerTenants, type TenantRow } from '@/lib/tenant-registry'
import { getWalletBalance } from '@/lib/payments/wallet'
import { defaultContact } from './contact'
import { getDomainPricing, quoteTld, tldOf, tldPrices } from './pricing'
import { listOrders, type DomainOrder } from './orders'
import { currentRenewal, type DomainRenewal } from './renewal'
import { domainPurchaseEnabled } from './providers'

/** The signed-in owner and one of their store tenants, or the error response. */
export async function ownerStore(request: NextRequest, tenantId: string | null | undefined) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })
  const tenant = (await getOwnerTenants(owner.id)).find(t => t.id === tenantId)
  if (!tenant) return NextResponse.json({ error: 'Store not found' }, { status: 404 })
  return { owner, tenant }
}

export type OwnerOrderView = Omit<DomainOrder, 'contact' | 'charge_ref' | 'operation_id' | 'hosted_zone_id' | 'cost_usd' | 'renewal_cost_usd' | 'usd_inr' | 'margin'> & {
  contactEmail: string
  /** What the next year costs at today's price and margin. */
  renewalPriceInr: number | null
  /** Every address the domain serves (apex, www., admin., invoice., …) and whether its certificate is issued. */
  hosts: { host: string; live: boolean }[]
  renewal: Pick<DomainRenewal, 'status' | 'price_inr' | 'term_expires_at' | 'last_error' | 'next_at'> | null
}

export async function ownerOrderView(o: DomainOrder): Promise<OwnerOrderView> {
  const { contact, charge_ref: _c, operation_id: _op, hosted_zone_id: _z, cost_usd: _cu, renewal_cost_usd: _rc, usd_inr: _u, margin: _m, ...rest } = o
  const r = o.expires_at ? await currentRenewal(o.id) : null
  const tld = tldOf(o.domain, (await tldPrices().catch(() => new Map())).keys())
  const q = tld ? await quoteTld(tld).catch(() => null) : null
  const hosts = (await controlPlanePool().query(`SELECT domain, status FROM tenant_custom_domains WHERE order_id = $1 ORDER BY created_at`, [o.id])).rows
  return {
    hosts: hosts.map(h => ({ host: h.domain, live: h.status === 'verified' })),
    ...rest,
    contactEmail: contact.email,
    renewalPriceInr: q?.renewalPriceInr ?? null,
    renewal: r && r.term_expires_at === o.expires_at ? { status: r.status, price_inr: r.price_inr, term_expires_at: r.term_expires_at, last_error: r.last_error, next_at: r.next_at } : null,
  }
}

/** Everything the owner's Domains card needs. */
export async function ownerDomainsState(tenant: TenantRow, owner: { email: string; name?: string | null }) {
  const [orders, wallet, settings, kyc] = await Promise.all([
    listOrders(tenant.id),
    getWalletBalance(tenant.id),
    getDomainPricing(),
    controlPlanePool()
      .query(`SELECT business_name, business_type, business_address, mobile, warehouse FROM tenant_kyc WHERE tenant_id = $1`, [tenant.id])
      .then(r => r.rows[0] ?? null)
      .catch(() => null),
  ])
  return {
    enabled: domainPurchaseEnabled(),
    orders: await Promise.all(orders.map(ownerOrderView)),
    walletInr: wallet.balance,
    renewLeadDays: settings.renewLeadDays,
    renewCutoffDays: settings.renewCutoffDays,
    contact: defaultContact({
      ownerName: owner.name,
      email: owner.email,
      mobile: kyc?.mobile,
      businessName: kyc?.business_name,
      businessType: kyc?.business_type,
      businessAddress: kyc?.business_address,
      warehouse: kyc?.warehouse,
    }),
  }
}
