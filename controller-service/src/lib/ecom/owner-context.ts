import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { getOwnerTenants, type Owner, type TenantRow } from '@/lib/tenant-registry'

export const TENANT_COOKIE = 'ecom_tenant'

export interface OwnerContext {
  owner: Owner
  tenants: TenantRow[]
  tenant: TenantRow
}

/** Resolve the signed-in owner + current tenant for /dashboard/* pages. Redirects on every gate. */
export async function loadOwnerContext(opts: { tenantSlug?: string } = {}): Promise<OwnerContext> {
  const jar = await cookies()
  const h = await headers()
  const owner = await resolveOwnerSession(jar.get(OWNER_COOKIE)?.value, {
    userAgent: h.get('user-agent'),
    acceptLanguage: h.get('accept-language'),
    uaPlatform: h.get('sec-ch-ua-platform'),
  } as any).catch(() => null)
  if (!owner) redirect('/signin')

  const tenants = await getOwnerTenants(owner.id)
  if (tenants.length === 0) redirect('/onboard')
  // A store-only tenant sits in /onboard until paid. Anything with messaging/documents enabled
  // already has a usable dashboard (its store upgrade, if any, is tracked on /dashboard/add-store).
  const storeOnly = (t: TenantRow) => (t.service_types ?? ['store']).every(s => s === 'store')
  if (tenants.every(t => storeOnly(t) && (t.status === 'pending_approval' || t.status === 'awaiting_payment'))) redirect('/onboard')

  const wanted = opts.tenantSlug ?? jar.get(TENANT_COOKIE)?.value
  const tenant =
    (wanted && tenants.find(t => t.slug === wanted)) || tenants.find(t => t.status === 'active') || tenants[0]
  return { owner, tenants, tenant }
}
