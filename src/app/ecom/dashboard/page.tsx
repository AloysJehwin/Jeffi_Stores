import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { getOwnerTenants } from '@/lib/tenant-registry'
import { StatusPill } from '@/components/admin/ecom/EcomUI'

export const dynamic = 'force-dynamic'

const SUB_PILL: Record<string, { label: string; cls: string }> = {
  active:        { label: 'Active',      cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  created:       { label: 'Pending',     cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  authenticated: { label: 'Pending',     cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  halted:        { label: 'Payment due', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  cancelled:     { label: 'Cancelled',   cls: 'bg-surface-secondary text-foreground-muted' },
}

export default async function OwnerDashboard() {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const h = await headers()
  const signals = { userAgent: h.get('user-agent'), acceptLanguage: h.get('accept-language'), uaPlatform: h.get('sec-ch-ua-platform') }
  const owner = await resolveOwnerSession(sid, signals as any).catch(() => null)
  if (!owner) redirect('/signin')

  const tenants = await getOwnerTenants(owner.id)
  const hasStore = tenants.length > 0

  // No store yet → send to onboard
  if (!hasStore) redirect('/onboard')

  // Store exists but not active yet → send to onboard status screen
  if (tenants[0].status !== 'active') redirect('/onboard')

  return (
    <div className="w-full min-h-screen bg-surface-secondary">
      {/* Top bar */}
      <div className="border-b border-border-default bg-surface-elevated px-6 lg:px-10 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-foreground">Dashboard</h1>
            <p className="text-xs text-foreground-muted mt-0.5">{owner.name || owner.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/billing"
              className="px-4 py-2 rounded-lg border border-border-default text-foreground-secondary hover:bg-surface-secondary text-sm font-medium transition-colors">
              Billing
            </Link>
            {!hasStore && (
              <Link href="/onboard"
                className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium transition-colors">
                + New store
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="px-6 lg:px-10 py-8">
        {!hasStore ? (
          /* ── Empty state ── */
          <div className="max-w-lg mx-auto mt-16 rounded-2xl border border-border-default bg-surface-elevated p-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800 flex items-center justify-center mx-auto mb-5">
              <svg className="w-7 h-7 text-accent-600 dark:text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5A2.25 2.25 0 0 0 11.25 11.25h-1.5A2.25 2.25 0 0 0 7.5 13.5V21M3 7.5A4.5 4.5 0 0 1 7.5 3h9A4.5 4.5 0 0 1 21 7.5v0a4.5 4.5 0 0 1-4.5 4.5h-9A4.5 4.5 0 0 1 3 7.5z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-foreground">No store yet</h2>
            <p className="text-foreground-muted text-sm mt-2 max-w-sm mx-auto">
              Launch your store in minutes — storefront, payments, delivery and GST all included.
            </p>
            <Link href="/onboard"
              className="inline-block mt-6 px-6 py-2.5 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-sm font-semibold transition-colors">
              Launch your store
            </Link>
          </div>
        ) : (
          <div className="space-y-5">
            {tenants.map((t) => {
              const sub = SUB_PILL[t.subscription_status] ?? { label: t.subscription_status, cls: 'bg-surface-secondary text-foreground-muted' }
              const monthly = Number(t.monthly_price_inr ?? 0)
              const price = t.billing_interval === 'yearly' ? monthly * 12 : monthly
              const isLive = t.status === 'active'

              return (
                <Link key={t.id} href={`/dashboard/store/${t.slug}`}
                  className="block rounded-2xl border border-border-default bg-surface-elevated hover:border-accent-400 hover:shadow-sm transition-all group overflow-hidden">

                  {/* Card header */}
                  <div className="px-6 py-5 flex flex-wrap items-start justify-between gap-3 border-b border-border-default/60">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-500 to-primary-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                        {t.display_name[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base font-bold text-foreground group-hover:text-accent-600 dark:group-hover:text-accent-400 transition-colors">
                            {t.display_name}
                          </span>
                          <StatusPill status={t.status} />
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${sub.cls}`}>
                            {sub.label}
                          </span>
                        </div>
                        <div className="text-xs text-foreground-muted mt-0.5 font-mono">{t.slug}.jeffistores.in</div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-semibold text-foreground capitalize">{t.plan ?? '—'} plan</div>
                      <div className="text-xs text-foreground-muted capitalize mt-0.5">
                        {price > 0 ? `₹${price.toLocaleString('en-IN')}/${t.billing_interval === 'yearly' ? 'yr' : 'mo'}` : '—'}
                      </div>
                    </div>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 divide-x divide-border-default/60">
                    {[
                      { label: 'Billing', value: t.billing_interval, capitalize: true },
                      { label: 'Subscription', value: sub.label, capitalize: false },
                      { label: 'Store status', value: t.status, capitalize: true },
                      { label: 'Since', value: new Date(t.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }), capitalize: false },
                      { label: 'Region', value: t.region ?? 'us-east-1', capitalize: false },
                      { label: 'Storefront', value: isLive ? 'Live' : 'Provisioning', capitalize: false },
                    ].map((s) => (
                      <div key={s.label} className="px-5 py-4">
                        <div className="text-[10px] text-foreground-muted uppercase tracking-widest mb-1">{s.label}</div>
                        <div className={`text-sm font-medium text-foreground ${s.capitalize ? 'capitalize' : ''}`}>{s.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Provisioned URLs — only when active */}
                  {isLive && (
                    <div className="px-6 py-3 bg-surface-secondary/50 border-t border-border-default/60 flex flex-wrap gap-x-8 gap-y-1.5 items-center">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-foreground-muted">Storefront</span>
                        <a href={`https://${t.slug}.jeffistores.in`} target="_blank" rel="noopener noreferrer"
                          className="font-mono text-accent-600 dark:text-accent-400 hover:underline">{t.slug}.jeffistores.in</a>
                      </div>
                      {t.rds_endpoint && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-foreground-muted">DB</span>
                          <span className="font-mono text-foreground">{t.rds_endpoint}</span>
                        </div>
                      )}
                      {t.s3_bucket && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-foreground-muted">Bucket</span>
                          <span className="font-mono text-foreground">{t.s3_bucket}</span>
                        </div>
                      )}
                      <span className="ml-auto text-xs text-accent-600 dark:text-accent-400 font-medium group-hover:underline">View details →</span>
                    </div>
                  )}

                  {/* Provisioning state */}
                  {!isLive && (
                    <div className="px-6 py-3 bg-surface-secondary/50 border-t border-border-default/60 flex items-center gap-2 text-xs text-foreground-muted">
                      <div className="w-3.5 h-3.5 border-2 border-accent-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      Provisioning — URLs will appear once your store is live.
                      <span className="ml-auto text-accent-600 dark:text-accent-400 font-medium group-hover:underline">View details →</span>
                    </div>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
