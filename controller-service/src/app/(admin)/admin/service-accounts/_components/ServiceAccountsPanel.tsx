import { queryMany } from '@/lib/shared/db'
import { headers } from 'next/headers'
import { ADMIN_SCOPES, hasScope } from '@/lib/auth/scopes'
import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { Plus } from 'lucide-react'
import { Kpi, KpiGrid, TabAction } from '@/components/admin/kit/core'
import { Card } from '@/components/admin/kit/layout'
import { EmptyState } from '@/components/admin/kit/states'
import { badgeCls } from '@/components/admin/kit/tones'
import ServiceAccountsTable from './ServiceAccountsTable'
import SettingsHub from '@/components/admin/SettingsHub'

async function getServiceAccounts() {
  return queryMany(
    `SELECT id, name, common_name, allowed_scopes, is_revoked, revoked_at,
            p12_downloaded, created_at, last_used_at
     FROM service_accounts
     ORDER BY created_at DESC`
  )
}

/** Service accounts tab of the Settings hub. */
export default async function ServiceAccountsPanel() {
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

  const createLink = canWrite ? (
    <span className="hidden md:inline-flex">
      <TabAction href={ap('/admin/service-accounts/add')} icon={<Plus className="w-4 h-4" />} label="Create" />
    </span>
  ) : undefined

  return (
    <>
      <SettingsHub active="service-accounts" actions={createLink} />
      <div className="p-4 sm:p-6 space-y-5">
        <KpiGrid>
          <Kpi label="Total" value={String(accounts.length)} />
          <Kpi label="Active" value={String(active)} />
          <Kpi label="Revoked" value={String(revoked)} />
          <Kpi label="Never Used" value={String(neverUsed)} sub={neverUsed > 0 ? 'Active but never called' : undefined} />
        </KpiGrid>

        <Card
          title="All Accounts"
          hint="M2M authentication via mTLS client certificates"
          action={!canWrite ? <span className={badgeCls('muted')}>Read-only access</span> : undefined}
          flush
        >
          {accounts.length === 0 ? (
            <EmptyState
              bare
              title="No service accounts"
              body="Create one to enable M2M authentication via mTLS."
              actionNode={
                canWrite ? (
                  <span className="hidden md:inline-flex">
                    <TabAction href={ap('/admin/service-accounts/add')} icon={<Plus className="w-4 h-4" />} label="Create first account" />
                  </span>
                ) : undefined
              }
            />
          ) : (
            <ServiceAccountsTable accounts={accounts as any[]} scopeLabels={scopeLabels} canWrite={canWrite} />
          )}
        </Card>

        {/* Scope reference */}
        <Card title="Scope Roles" hint="Assign the minimum scopes needed — write always implies read">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    className={badgeCls('muted')}
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
                Can call POST, PUT, DELETE endpoints. Grants write implicitly includes read. Use only for automation
                that needs to mutate data.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ADMIN_SCOPES.filter(s => s.key.endsWith(':write')).map(s => (
                  <span
                    key={s.key}
                    className={badgeCls('amber')}
                  >
                    {s.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </>
  )
}
