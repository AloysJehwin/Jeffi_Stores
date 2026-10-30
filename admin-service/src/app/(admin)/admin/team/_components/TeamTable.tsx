'use client'

import AdminUserActions from '@/components/admin/AdminUserActions'
import { isPlatformOwner } from '@/lib/auth/scopes'
import { DataTable, type DataCol } from '@/components/admin/kit/data-table'
import { StatusBadge, type StatusMap } from '@/components/admin/kit/status'
import { badgeCls } from '@/components/admin/kit/tones'
import TeamMobileList from './TeamMobileList'

const CERT_STATUS: StatusMap = {
  Active: { label: 'Active', tone: 'green' },
  'Pending Download': { label: 'Pending Download', tone: 'amber' },
  Revoked: { label: 'Revoked', tone: 'red' },
  Expired: { label: 'Expired', tone: 'red' },
  'No Certificate': { label: 'No Certificate', tone: 'muted' },
}

const name = (a: any) => (a.first_name && a.last_name ? `${a.first_name} ${a.last_name}` : a.username)

/** Members table of the Team tab; cert statuses are computed on the server and passed by id. */
export default function TeamTable({
  admins,
  currentAdminId,
  allowedScopeKeys,
  scopeLabels,
  certStatuses,
}: {
  admins: any[]
  currentAdminId: string
  allowedScopeKeys?: string[]
  scopeLabels: Record<string, string>
  certStatuses: Record<string, string>
}) {
  const cols: DataCol<any>[] = [
    {
      key: 'member',
      label: 'Member',
      sort: a => name(a).toLowerCase(),
      render: a => (
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-surface-secondary flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-foreground-secondary uppercase">{(a.first_name || a.username)[0]}</span>
          </div>
          <p className="min-w-0 truncate font-medium text-foreground">
            {name(a)}
            {a.id === currentAdminId && <span className="ml-1 text-xs font-normal text-accent-500">(you)</span>}
          </p>
        </div>
      ),
    },
    { key: 'role', label: 'Role', sort: a => a.role, render: a => <span className="text-xs text-foreground-secondary capitalize">{a.role.replace('_', ' ')}</span> },
    {
      key: 'scopes',
      label: 'Scopes',
      sortType: 'number',
      sort: a => (isPlatformOwner(a.role) ? Infinity : (a.scopes || []).length),
      className: 'max-w-[260px]',
      render: a => {
        const scopes: string[] = a.scopes || []
        const visible = scopes.slice(0, 3)
        const overflow = scopes.length - visible.length
        if (isPlatformOwner(a.role)) return <span className={badgeCls('blue')}>All</span>
        if (!scopes.length) return <span className="text-xs text-foreground-muted">None</span>
        return (
          <div className="flex flex-wrap items-center gap-1">
            {visible.map(s => (
              <span key={s} className={badgeCls('muted')}>
                {scopeLabels[s] || s}
              </span>
            ))}
            {overflow > 0 && <span className={badgeCls('muted')}>+{overflow}</span>}
          </div>
        )
      },
    },
    { key: 'status', label: 'Status', sort: a => (a.is_active !== false ? 0 : 1), render: a => <StatusBadge status={a.is_active !== false ? 'true' : 'false'} map={{ true: { label: 'Active', tone: 'green' }, false: { label: 'Inactive', tone: 'muted' } }} /> },
    { key: 'mfa', label: '2FA', sort: a => (a.mfa_enabled ? 0 : 1), render: a => <span className={badgeCls(a.mfa_enabled ? 'green' : 'amber')}>{a.mfa_enabled ? 'On' : 'Off'}</span> },
    { key: 'mobile', label: 'Mobile', sort: a => a.mobile_hint ?? '~', hideBelow: 'lg', render: a => <span className="text-xs text-foreground-secondary whitespace-nowrap">{a.mobile_hint ?? '—'}</span> },
    { key: 'cert', label: 'Certificate', sort: a => certStatuses[a.id] ?? 'No Certificate', render: a => <StatusBadge status={certStatuses[a.id] ?? 'No Certificate'} map={CERT_STATUS} /> },
    {
      key: 'expiry',
      label: 'Expiry',
      sortType: 'date',
      sort: a => {
        const cert = (a.certificates as any[])?.[0]
        return cert && !cert.is_revoked ? new Date(cert.expires_at).getTime() : 0
      },
      hideBelow: 'xl',
      render: a => {
        const cert = (a.certificates as any[])?.[0]
        return <span className="text-xs text-foreground-secondary whitespace-nowrap">{cert && !cert.is_revoked ? new Date(cert.expires_at).toLocaleDateString('en-IN') : '—'}</span>
      },
    },
    {
      key: 'login',
      label: 'Last Login',
      sortType: 'date',
      sort: a => (a.last_login ? new Date(a.last_login).getTime() : 0),
      hideBelow: 'lg',
      render: a => (
        <span className="text-xs text-foreground-secondary whitespace-nowrap">
          {a.last_login
            ? new Date(a.last_login).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : 'Never'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: <span className="sr-only">Actions</span>,
      render: a => (
        <div className="flex items-center justify-end">
          <AdminUserActions admin={a} currentAdminId={currentAdminId} allowedScopeKeys={allowedScopeKeys} />
        </div>
      ),
    },
  ]

  return (
    <DataTable
      rows={admins}
      cols={cols}
      rowKey={a => String(a.id)}
      pageSize={Math.max(25, admins.length)}
      empty="No team members yet."
      mobile={rows => <TeamMobileList admins={rows} currentAdminId={currentAdminId} scopeLabels={scopeLabels} />}
      bare
    />
  )
}
