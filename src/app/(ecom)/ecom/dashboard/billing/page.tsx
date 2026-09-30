import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { getOwnerTenants, listPlans } from '@/lib/tenant-registry'
import { getSubscription } from '@/lib/payments/razorpay-subscriptions'
import BillingClient from './BillingClient'

export const dynamic = 'force-dynamic'

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const h = await headers()
  const signals = {
    userAgent: h.get('user-agent'),
    acceptLanguage: h.get('accept-language'),
    uaPlatform: h.get('sec-ch-ua-platform'),
  }
  const owner = await resolveOwnerSession(sid, signals as any).catch(() => null)
  if (!owner) redirect('/signin')

  const { tenant: tenantSlug } = await searchParams
  const tenants = await getOwnerTenants(owner.id)
  const tenant = tenantSlug ? tenants.find(t => t.slug === tenantSlug) : tenants[0]
  if (!tenant) redirect('/dashboard')
  if (tenant.status !== 'active') redirect('/onboard')

  const plans = await listPlans()

  // Fetch renewal date from Razorpay if subscription is active.
  let renewalDate: string | null = null
  if (tenant.razorpay_subscription_id && tenant.subscription_status === 'active') {
    const sub = await getSubscription(tenant.razorpay_subscription_id).catch(() => null)
    if (sub?.current_end) {
      renewalDate = new Date(sub.current_end * 1000).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    }
  }

  return (
    <div className="w-full px-6 lg:px-10 py-10">
      <div className="flex items-center gap-3 mb-8">
        <Link href="/dashboard" className="text-sm text-foreground-muted hover:text-foreground">
          ← Dashboard
        </Link>
        <span className="text-foreground-muted">/</span>
        <h1 className="text-xl font-bold text-foreground">Billing</h1>
        {tenants.length > 1 && (
          <select
            defaultValue={tenant.slug}
            onChange={e => {
              window.location.href = `/dashboard/billing?tenant=${e.target.value}`
            }}
            className="ml-auto text-sm rounded-lg border border-border-default bg-surface-elevated px-3 py-1.5 text-foreground"
          >
            {tenants.map(t => (
              <option key={t.id} value={t.slug}>
                {t.display_name}
              </option>
            ))}
          </select>
        )}
      </div>

      <BillingClient tenant={tenant} plans={plans} renewalDate={renewalDate} />
    </div>
  )
}
