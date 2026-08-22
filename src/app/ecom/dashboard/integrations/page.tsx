import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { getOwnerTenants, listIntegrationCredentials, getTenantSocialAccounts } from '@/lib/tenant-registry'
import IntegrationsClient from './IntegrationsClient'

export const dynamic = 'force-dynamic'

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const h = await headers()
  const signals = { userAgent: h.get('user-agent'), acceptLanguage: h.get('accept-language'), uaPlatform: h.get('sec-ch-ua-platform') }
  const owner = await resolveOwnerSession(sid, signals as any).catch(() => null)
  if (!owner) redirect('/signin')

  const { tenant: tenantSlug } = await searchParams
  const tenants = await getOwnerTenants(owner.id)
  const tenant = tenantSlug ? tenants.find((t) => t.slug === tenantSlug) : tenants.find((t) => t.status === 'active') ?? tenants[0]

  return (
    <div className="w-full px-6 lg:px-10 py-10">
      <div className="flex items-center gap-3 mb-8">
        <Link href="/dashboard" className="text-sm text-foreground-muted hover:text-foreground">← Dashboard</Link>
        <span className="text-foreground-muted">/</span>
        <h1 className="text-xl font-bold text-foreground">Integrations</h1>
        {tenants.length > 1 && (
          <select defaultValue={tenant?.slug}
            onChange={(e) => { window.location.href = `/dashboard/integrations?tenant=${e.target.value}` }}
            className="ml-auto text-sm rounded-lg border border-border-default bg-surface-elevated px-3 py-1.5 text-foreground">
            {tenants.map((t) => <option key={t.id} value={t.slug}>{t.display_name}</option>)}
          </select>
        )}
      </div>

      {!tenant || tenant.status !== 'active' ? (
        <div className="max-w-lg rounded-2xl border border-border-default bg-surface-elevated p-10 text-center">
          <h2 className="text-lg font-semibold text-foreground">Provision your store first</h2>
          <p className="text-foreground-muted text-sm mt-2">
            Integrations become available once your store is live. Finish onboarding to connect Google Merchant, Amazon and Meta.
          </p>
          <Link href="/onboard"
            className="inline-block mt-6 px-6 py-2.5 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-sm font-semibold transition-colors">
            Launch your store
          </Link>
        </div>
      ) : (
        <IntegrationsClient
          tenant={{ id: tenant.id, slug: tenant.slug, display_name: tenant.display_name }}
          integrations={await listIntegrationCredentials(tenant.id)}
          socialAccounts={await getTenantSocialAccounts(tenant.id)}
        />
      )}
    </div>
  )
}
