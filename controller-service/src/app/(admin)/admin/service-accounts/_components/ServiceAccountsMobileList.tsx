'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldOff } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'

interface ServiceAccount {
  id: string
  name: string
  common_name: string
  allowed_scopes: string[] | null
  is_revoked: boolean
  created_at: string
  last_used_at: string | null
}

interface Props {
  accounts: ServiceAccount[]
  scopeLabels: Record<string, string>
  canWrite: boolean
}

function relativeTime(date: string | null): string {
  if (!date) return 'Never'
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function ServiceAccountsMobileList({ accounts, scopeLabels, canWrite }: Props) {
  const router = useRouter()
  const { showToast, showConfirm } = useToast()

  const [selected, setSelected] = useState<ServiceAccount | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function revoke(sa: ServiceAccount) {
    const confirmed = await showConfirm({
      title: 'Revoke service account?',
      message: `"${sa.name}" will be permanently revoked. Any systems using this certificate will immediately lose access. This cannot be undone.`,
      confirmText: 'Revoke',
      cancelText: 'Cancel',
      type: 'danger',
    })
    if (!confirmed || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/service-accounts/${sa.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        showToast(data.error || 'Failed to revoke service account', 'error')
        return
      }
      setSelected(null)
      showToast(`Service account "${sa.name}" revoked`, 'success')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  function buildActions(sa: ServiceAccount): MobileAction[] {
    const actions: MobileAction[] = []
    if (canWrite && !sa.is_revoked) {
      actions.push({
        key: 'revoke',
        label: 'Revoke service account',
        icon: <ShieldOff className="w-4 h-4" />,
        danger: true,
        disabled: busy,
        onSelect: () => revoke(sa),
      })
    }
    return actions
  }

  return (
    <div className="divide-y divide-border-default">
      {accounts.map(sa => {
        const saScopes = sa.allowed_scopes || []
        return (
          <div key={sa.id} className="py-3 first:pt-0 last:pb-0">
            <MobileListCard accent={sa.is_revoked} ariaLabel={`Open ${sa.name}`} onTap={() => setSelected(sa)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground truncate">{sa.name}</div>
                  <div className="text-xs text-foreground-muted font-mono truncate mt-0.5">{sa.common_name}</div>
                </div>
                <span
                  className={`flex-shrink-0 px-2 py-0.5 text-xs font-semibold rounded-full ${
                    sa.is_revoked
                      ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                      : 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                  }`}
                >
                  {sa.is_revoked ? 'Revoked' : 'Active'}
                </span>
              </div>
              <div className="text-xs text-foreground-muted mt-2">
                {saScopes.length} scope{saScopes.length === 1 ? '' : 's'} ·{' '}
                {sa.last_used_at ? `used ${relativeTime(sa.last_used_at)}` : 'never used'}
              </div>
            </MobileListCard>
          </div>
        )
      })}

      <MobileDetailSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name}
        subtitle={selected?.common_name}
        footer={
          selected && canWrite && !selected.is_revoked ? (
            <button
              type="button"
              onClick={() => setActionsOpen(true)}
              className="w-full bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
            >
              Actions
            </button>
          ) : undefined
        }
      >
        {selected && (
          <div className="p-5 space-y-4">
            <div className="flex flex-wrap gap-2">
              <span
                className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                  selected.is_revoked
                    ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                    : 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                }`}
              >
                {selected.is_revoked ? 'Revoked' : 'Active'}
              </span>
            </div>
            <div>
              <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1.5">Scopes</p>
              <div className="flex flex-wrap gap-1">
                {(selected.allowed_scopes || []).length > 0 ? (
                  (selected.allowed_scopes || []).map(s => (
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
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border-default pt-4">
              <div>
                <p className="text-xs text-foreground-muted">Created</p>
                <p className="text-sm text-foreground font-medium">
                  {new Date(selected.created_at).toLocaleDateString('en-IN')}
                </p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Last used</p>
                <p className="text-sm text-foreground font-medium">{relativeTime(selected.last_used_at)}</p>
              </div>
            </div>
          </div>
        )}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!selected}
        onClose={() => setActionsOpen(false)}
        title={selected?.name}
        actions={selected ? buildActions(selected) : []}
      />
    </div>
  )
}
