import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { getOwnerTenants } from '@/lib/tenant-registry'
import { StatusPill } from '@/components/admin/ecom/EcomUI'

export const dynamic = 'force-dynamic'

export default async function OwnerDashboard() {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const h = await headers()
  const signals = { userAgent: h.get('user-agent'), acceptLanguage: h.get('accept-language'), uaPlatform: h.get('sec-ch-ua-platform') }
  const owner = await resolveOwnerSession(sid, signals as any).catch(() => null)
  if (!owner) redirect('/signin')
  const tenants = await getOwnerTenants(owner.id)

  return (
    <div className="max-w-4xl mx-auto py-12 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Your stores</h1>
          <p className="text-sm text-foreground-muted mt-1">{owner.name || owner.email}</p>
        </div>
        <Link href="/onboard" className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium">+ New store</Link>
      </div>

      {tenants.length === 0 ? (
        <div className="rounded-2xl border border-border-default bg-surface-elevated p-10 text-center">
          <p className="text-foreground-muted">You haven&apos;t created a store yet.</p>
          <Link href="/onboard" className="inline-block mt-4 px-5 py-2.5 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium">Launch your first store</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {tenants.map((t) => (
            <div key={t.id} className="rounded-xl border border-border-default bg-surface-elevated p-5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">{t.display_name}</span>
                <StatusPill status={t.status} />
              </div>
              <div className="text-sm text-foreground-muted mt-1">{t.slug}.jeffistores.in</div>
              <div className="text-xs text-foreground-muted mt-2 capitalize">Plan: {t.plan || '—'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
