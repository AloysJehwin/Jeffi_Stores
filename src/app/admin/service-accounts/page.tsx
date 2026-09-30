import { queryMany } from '@/lib/shared/db'
import { headers } from 'next/headers'
import { ADMIN_SCOPES, hasScope } from '@/lib/auth/scopes'
import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import Link from 'next/link'
import ServiceAccountRevokeButton from '@/components/admin/ServiceAccountRevokeButton'

async function getServiceAccounts() {
  return queryMany(
    `SELECT id, name, common_name, allowed_scopes, is_revoked, revoked_at,
            p12_downloaded, created_at, last_used_at
     FROM service_accounts
     ORDER BY created_at DESC`
  )
}

function relativeTime(date: string | null): string {
  if (!date) return '—'
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(date).toLocaleDateString('en-IN')
}

function StatusBadge({ isRevoked }: { isRevoked: boolean }) {
  if (isRevoked) {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
        Revoked
      </span>
    )
  }
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
      Active
    </span>
  )
}

function ScopeBadge({ scope, label }: { scope: string; label: string }) {
  const isWrite = scope.endsWith(':write')
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
        isWrite
          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
          : 'bg-surface-secondary text-foreground-secondary'
      }`}
    >
      {label}
    </span>
  )
}

export default async function ServiceAccountsPage() {
  const headersList = await headers()
  const role = headersList.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(headersList.get('x-user-scopes') || '[]')

  if (!hasScope(role, scopes, 'service_accounts:read')) redirect(ap('/admin/settings'))

  const canWrite = hasScope(role, scopes, 'service_accounts:write')
  const accounts = await getServiceAccounts()

  const scopeLabels: Record<string, string> = {}
  ADMIN_SCOPES.forEach(s => {
    scopeLabels[s.key] = s.label
  })

  const active = accounts.filter((a: any) => !a.is_revoked).length
  const revoked = accounts.length - active
  const neverUsed = accounts.filter((a: any) => !a.last_used_at && !a.is_revoked).length

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Service Accounts</h1>
          <p className="text-sm text-foreground-muted mt-0.5">M2M authentication via mTLS client certificates</p>
        </div>
        {canWrite && (
          <div className="hidden md:block">
            <Link
              href={ap('/admin/service-accounts/add')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-secondary-500 hover:bg-secondary-600 text-white text-sm font-medium transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Create
            </Link>
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: accounts.length },
          { label: 'Active', value: active, color: 'text-green-600 dark:text-green-400' },
          { label: 'Revoked', value: revoked, color: revoked > 0 ? 'text-red-600 dark:text-red-400' : undefined },
          {
            label: 'Never Used',
            value: neverUsed,
            color: neverUsed > 0 ? 'text-amber-600 dark:text-amber-400' : undefined,
          },
        ].map(stat => (
          <div key={stat.label} className="bg-surface-elevated rounded-xl border border-border-default px-4 py-3">
            <p className="text-xs text-foreground-muted uppercase tracking-wider">{stat.label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${stat.color || 'text-foreground'}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <section className="bg-surface-elevated rounded-xl border border-border-default shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border-default flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">All Accounts</h2>
          {!canWrite && (
            <span className="text-xs text-foreground-muted bg-surface-secondary px-2 py-1 rounded-lg">
              Read-only access
            </span>
          )}
        </div>

        {accounts.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-surface-secondary flex items-center justify-center">
              <svg
                className="w-7 h-7 text-foreground-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-foreground">No service accounts</p>
            <p className="text-xs text-foreground-muted mt-1 mb-4">Create one to enable M2M authentication via mTLS.</p>
            {canWrite && (
              <Link
                href={ap('/admin/service-accounts/add')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-secondary-500 hover:bg-secondary-600 text-white text-sm font-medium transition-colors"
              >
                Create first account
              </Link>
            )}
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-border-default">
              {accounts.map((sa: any) => {
                const saScopes: string[] = sa.allowed_scopes || []
                return (
                  <div key={sa.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-secondary-500/10 dark:bg-secondary-400/10 flex items-center justify-center shrink-0">
                            <svg
                              className="w-3.5 h-3.5 text-secondary-600 dark:text-secondary-400"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                              />
                            </svg>
                          </div>
                          <p className="text-sm font-semibold text-foreground">{sa.name}</p>
                        </div>
                        <p className="text-xs text-foreground-muted font-mono mt-1 ml-9">{sa.common_name}</p>
                      </div>
                      <StatusBadge isRevoked={sa.is_revoked} />
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {saScopes.length > 0 ? (
                        saScopes.map((s: string) => <ScopeBadge key={s} scope={s} label={scopeLabels[s] || s} />)
                      ) : (
                        <span className="text-xs text-foreground-muted">No scopes</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-xs text-foreground-muted">
                      <span>Created {new Date(sa.created_at).toLocaleDateString('en-IN')}</span>
                      <span>{sa.last_used_at ? `Used ${relativeTime(sa.last_used_at)}` : 'Never used'}</span>
                    </div>
                    {canWrite && !sa.is_revoked && (
                      <div className="hidden md:block">
                        <ServiceAccountRevokeButton id={sa.id} name={sa.name} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-default bg-surface-secondary/40">
                    <th className="px-5 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                      Account
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                      Cert CN
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                      Scopes
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider w-24">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider w-28">
                      Created
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider w-28">
                      Last Used
                    </th>
                    {canWrite && (
                      <th className="px-4 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider w-28">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-default">
                  {accounts.map((sa: any) => {
                    const saScopes: string[] = sa.allowed_scopes || []
                    const visible = saScopes.slice(0, 3)
                    const overflow = saScopes.length - visible.length
                    return (
                      <tr key={sa.id} className="hover:bg-surface-secondary/30 transition-colors">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-secondary-500/10 dark:bg-secondary-400/10 flex items-center justify-center shrink-0">
                              <svg
                                className="w-3.5 h-3.5 text-secondary-600 dark:text-secondary-400"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                                />
                              </svg>
                            </div>
                            <span className="font-medium text-foreground">{sa.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-foreground-muted font-mono">{sa.common_name}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {saScopes.length > 0 ? (
                              <>
                                {visible.map((s: string) => (
                                  <ScopeBadge key={s} scope={s} label={scopeLabels[s] || s} />
                                ))}
                                {overflow > 0 && (
                                  <span className="px-2 py-0.5 bg-surface-secondary text-foreground-muted rounded-full text-xs">
                                    +{overflow}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-xs text-foreground-muted">None</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge isRevoked={sa.is_revoked} />
                        </td>
                        <td className="px-4 py-3 text-xs text-foreground-secondary">
                          {new Date(sa.created_at).toLocaleDateString('en-IN')}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {sa.last_used_at ? (
                            <span
                              className="text-foreground-secondary"
                              title={new Date(sa.last_used_at).toLocaleString('en-IN')}
                            >
                              {relativeTime(sa.last_used_at)}
                            </span>
                          ) : (
                            <span className="text-foreground-muted italic">Never</span>
                          )}
                        </td>
                        {canWrite && (
                          <td className="px-4 py-3 text-right">
                            {!sa.is_revoked && <ServiceAccountRevokeButton id={sa.id} name={sa.name} />}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Scope reference */}
      <section className="bg-surface-elevated rounded-xl border border-border-default shadow-sm">
        <div className="px-5 py-4 border-b border-border-default">
          <h2 className="text-sm font-semibold text-foreground">Scope Roles</h2>
          <p className="text-xs text-foreground-muted mt-0.5">
            Assign the minimum scopes needed — write always implies read
          </p>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-surface rounded-lg border border-border-default p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-surface-secondary border border-foreground-muted shrink-0" />
              <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">Read-only scopes</p>
            </div>
            <p className="text-xs text-foreground-muted">
              Can call GET endpoints only. Safe to give to monitoring scripts, dashboards, and read-heavy automation.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {ADMIN_SCOPES.filter(s => s.key.endsWith(':read')).map(s => (
                <span
                  key={s.key}
                  className="px-2 py-0.5 bg-surface-secondary text-foreground-secondary rounded-full text-xs"
                >
                  {s.label}
                </span>
              ))}
            </div>
          </div>
          <div className="bg-surface rounded-lg border border-border-default p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
              <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">Write scopes</p>
            </div>
            <p className="text-xs text-foreground-muted">
              Can call POST, PUT, DELETE endpoints. Grants write implicitly includes read. Use only for automation that
              needs to mutate data.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {ADMIN_SCOPES.filter(s => s.key.endsWith(':write')).map(s => (
                <span
                  key={s.key}
                  className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full text-xs"
                >
                  {s.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
