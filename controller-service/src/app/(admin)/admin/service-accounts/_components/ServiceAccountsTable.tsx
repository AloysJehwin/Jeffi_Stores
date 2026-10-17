'use client'

import ServiceAccountRowActions from '@/components/admin/ServiceAccountRowActions'
import { DataTable, type DataCol } from '@/components/admin/kit/data-table'
import { badgeCls } from '@/components/admin/kit/tones'
import ServiceAccountsMobileList from './ServiceAccountsMobileList'

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

export default function ServiceAccountsTable({ accounts, scopeLabels, canWrite }: { accounts: any[]; scopeLabels: Record<string, string>; canWrite: boolean }) {
  const cols: DataCol<any>[] = [
    { key: 'name', label: 'Account', render: sa => <span className="font-medium text-foreground">{sa.name}</span> },
    { key: 'cn', label: 'Cert CN', hideBelow: 'lg', render: sa => <span className="font-mono text-xs text-foreground-muted">{sa.common_name}</span> },
    {
      key: 'scopes',
      label: 'Scopes',
      render: sa => {
        const s: string[] = sa.allowed_scopes || []
        if (!s.length) return <span className="text-xs text-foreground-muted">None</span>
        const visible = s.slice(0, 3)
        return (
          <div className="flex flex-wrap gap-1">
            {visible.map(k => (
              <span key={k} className={badgeCls(k.endsWith(':write') ? 'amber' : 'muted')}>
                {scopeLabels[k] || k}
              </span>
            ))}
            {s.length > visible.length && <span className={badgeCls('muted')}>+{s.length - visible.length}</span>}
          </div>
        )
      },
    },
    { key: 'status', label: 'Status', render: sa => <span className={badgeCls(sa.is_revoked ? 'red' : 'green')}>{sa.is_revoked ? 'Revoked' : 'Active'}</span> },
    { key: 'created', label: 'Created', render: sa => <span className="text-xs text-foreground-secondary">{new Date(sa.created_at).toLocaleDateString('en-IN')}</span> },
    {
      key: 'used',
      label: 'Last Used',
      render: sa =>
        sa.last_used_at ? (
          <span className="text-xs text-foreground-secondary" title={new Date(sa.last_used_at).toLocaleString('en-IN')}>
            {relativeTime(sa.last_used_at)}
          </span>
        ) : (
          <span className="text-xs italic text-foreground-muted">Never</span>
        ),
    },
  ]
  if (canWrite)
    cols.push({
      key: 'actions',
      label: <span className="sr-only">Actions</span>,
      render: sa =>
        !sa.is_revoked ? (
          <div className="flex justify-end">
            <ServiceAccountRowActions id={sa.id} name={sa.name} />
          </div>
        ) : null,
    })

  return (
    <DataTable
      rows={accounts}
      cols={cols}
      rowKey={sa => String(sa.id)}
      pageSize={Math.max(25, accounts.length)}
      mobile={
        <div className="p-4">
          <ServiceAccountsMobileList accounts={accounts as any} scopeLabels={scopeLabels} canWrite={canWrite} />
        </div>
      }
      bare
    />
  )
}
