'use client'

import { useState } from 'react'
import { isPlatformOwner } from '@/lib/auth/scopes'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'

interface Props {
  admins: any[]
  currentAdminId: string
  scopeLabels: Record<string, string>
}

function displayName(admin: any) {
  return admin.first_name && admin.last_name ? `${admin.first_name} ${admin.last_name}` : admin.username
}

function certStatus(admin: any): string {
  const certs = admin.certificates as any[] | null
  if (!certs || certs.length === 0) return 'No Certificate'
  const latest = certs[0]
  if (latest.is_revoked) return 'Revoked'
  if (new Date(latest.expires_at) < new Date()) return 'Expired'
  if (latest.downloaded_at) return 'Active'
  if (isPlatformOwner(admin.role)) return 'Active'
  return 'Pending Download'
}

export default function TeamMobileList({ admins, currentAdminId, scopeLabels }: Props) {
  const [selected, setSelected] = useState<any>(null)

  return (
    <div className="divide-y divide-border-default">
      {admins.map(admin => {
        const scopes: string[] = admin.scopes || []
        const isSuper = isPlatformOwner(admin.role)
        return (
          <div key={admin.id} className="py-3 first:pt-0 last:pb-0">
            <MobileListCard ariaLabel={`View ${displayName(admin)}`} onTap={() => setSelected(admin)}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-secondary-500/10 dark:bg-secondary-400/10 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-secondary-600 dark:text-secondary-400 uppercase">
                      {(admin.first_name || admin.username)[0]}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {displayName(admin)}
                      {admin.id === currentAdminId && (
                        <span className="ml-1.5 text-xs font-normal text-accent-500">(you)</span>
                      )}
                    </p>
                    <p className="text-xs text-foreground-muted capitalize">{admin.role.replace('_', ' ')}</p>
                  </div>
                </div>
                <span
                  className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
                    admin.is_active !== false
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                      : 'bg-surface-secondary text-foreground-muted'
                  }`}
                >
                  {admin.is_active !== false ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {isSuper ? (
                  <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-xs font-medium">
                    All Access
                  </span>
                ) : scopes.length > 0 ? (
                  <>
                    {scopes.slice(0, 4).map(scope => (
                      <span
                        key={scope}
                        className="px-2 py-0.5 bg-surface-secondary text-foreground-secondary rounded-full text-xs"
                      >
                        {scopeLabels[scope] || scope}
                      </span>
                    ))}
                    {scopes.length > 4 && (
                      <span className="px-2 py-0.5 bg-surface-secondary text-foreground-muted rounded-full text-xs">
                        +{scopes.length - 4}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-foreground-muted">No scopes</span>
                )}
              </div>
            </MobileListCard>
          </div>
        )
      })}

      <MobileDetailSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? displayName(selected) : undefined}
        subtitle={selected?.username}
      >
        {selected && (
          <div className="p-5 space-y-4">
            <div className="flex flex-wrap gap-2">
              <span
                className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                  selected.is_active !== false
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                    : 'bg-surface-secondary text-foreground-muted'
                }`}
              >
                {selected.is_active !== false ? 'Active' : 'Inactive'}
              </span>
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-surface-secondary text-foreground-secondary capitalize">
                {selected.role.replace('_', ' ')}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <div>
                <p className="text-xs text-foreground-muted">Certificate</p>
                <p className="text-sm text-foreground font-medium">{certStatus(selected)}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">2FA</p>
                <p className="text-sm text-foreground font-medium">{selected.mfa_enabled ? 'Enabled' : 'Disabled'}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Last login</p>
                <p className="text-sm text-foreground font-medium">
                  {selected.last_login ? new Date(selected.last_login).toLocaleDateString('en-IN') : 'Never'}
                </p>
              </div>
            </div>
            <div className="border-t border-border-default pt-4">
              <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1.5">Scopes</p>
              <div className="flex flex-wrap gap-1">
                {isPlatformOwner(selected.role) ? (
                  <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-xs font-medium">
                    All Access
                  </span>
                ) : (selected.scopes || []).length > 0 ? (
                  (selected.scopes as string[]).map(s => (
                    <span
                      key={s}
                      className="px-2 py-0.5 text-xs rounded-full bg-surface-secondary text-foreground-secondary"
                    >
                      {scopeLabels[s] || s}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-foreground-muted">No scopes</span>
                )}
              </div>
            </div>
            <p className="text-xs text-foreground-muted border-t border-border-default pt-4">
              Open this page on a larger screen to manage team members.
            </p>
          </div>
        )}
      </MobileDetailSheet>
    </div>
  )
}
