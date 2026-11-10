'use client'

import { useRouter } from 'next/navigation'
import { DataTable, useActionToast, type DataCol } from '@/components/admin/kit'
import RowActions, { type RowAction } from '@/components/admin/RowActions'
import type { AdminCertRow } from '@/lib/tenancy/tenant-ca'

const daysUntil = (when: string) => Math.floor((new Date(when).getTime() - Date.now()) / 86_400_000)
const day = (v: string) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

function Expiry({ at }: { at: string }) {
  const d = daysUntil(at)
  const cls = d < 0 ? 'text-red-600 dark:text-red-400' : d < 30 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'
  return (
    <span className={cls}>
      {day(at)}
      <span className="text-xs ml-1.5">{d < 0 ? `expired ${-d}d ago` : `${d}d left`}</span>
    </span>
  )
}

function State({ c }: { c: AdminCertRow }) {
  if (c.revoked_at) return <span className="text-xs text-red-600 dark:text-red-400 break-words">revoked{c.revoked_by ? ` by ${c.revoked_by}` : ''}</span>
  if (new Date(c.expires_at) <= new Date()) return <span className="text-xs text-foreground-muted">expired</span>
  return <span className="text-xs text-green-600 dark:text-green-400">active</span>
}

const Holder = ({ c }: { c: AdminCertRow }) => (
  <div className="min-w-0">
    <div className="text-foreground break-all">{c.common_name}</div>
    {c.issued_to && c.issued_to !== c.common_name && <div className="text-xs text-foreground-muted break-all">{c.issued_to}</div>}
  </div>
)

const COLS: DataCol<AdminCertRow>[] = [
  { key: 'holder', label: 'Holder', sort: c => c.common_name, render: c => <Holder c={c} /> },
  { key: 'serial', label: 'Serial', hideBelow: 'lg', sort: c => c.serial, render: c => <span className="font-mono text-xs">{c.serial.slice(0, 16)}…</span> },
  { key: 'issued', label: 'Issued', sortType: 'date', sort: c => new Date(c.issued_at).getTime(), render: c => <span className="text-xs text-foreground-muted">{day(c.issued_at)}</span> },
  { key: 'expires', label: 'Expires', sortType: 'date', sort: c => new Date(c.expires_at).getTime(), render: c => <span className="text-xs"><Expiry at={c.expires_at} /></span> },
  { key: 'state', label: 'State', sort: c => (c.revoked_at ? 2 : new Date(c.expires_at) <= new Date() ? 1 : 0), render: c => <State c={c} /> },
]

/** Admin client certificates for the store's mTLS admin host; an active one can be revoked. */
export default function CertsTable({ tenantId, certs }: { tenantId: string; certs: AdminCertRow[] }) {
  const router = useRouter()
  const toast = useActionToast()

  const revoke = async (c: AdminCertRow) => {
    const res = await fetch(`/api/admin/ecom/${tenantId}/certs/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial: c.serial }),
    }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    if (!res?.ok) return toast.error(data?.error || 'Could not revoke the certificate')
    toast.success(data?.alreadyRevoked ? 'Already revoked' : `Revoked ${c.common_name}`)
    router.refresh()
  }

  const actions = (c: AdminCertRow): RowAction[] => [
    {
      key: 'revoke',
      kind: 'revoke',
      onSelect: () => revoke(c),
      hidden: !!c.revoked_at || new Date(c.expires_at) <= new Date(),
      confirm: {
        title: `Revoke ${c.common_name}?`,
        message: 'This certificate stops opening the store’s admin panel immediately and cannot be downloaded again. Issue a new one to restore access.',
        confirmLabel: 'Revoke',
        variant: 'danger',
      },
    },
  ]

  return (
    <DataTable
      sortNs="certs"
      rows={certs}
      cols={COLS}
      rowKey={c => c.id}
      rowActions={actions}
      noun="certificates"
      paged
      empty="No client certificates issued."
      bare
      mobileCard={c => (
        <div className="rounded-xl border border-border-default bg-surface-elevated p-3 space-y-1.5 min-w-0">
          <div className="flex items-start justify-between gap-2 min-w-0">
            <div className="min-w-0 text-sm">
              <Holder c={c} />
            </div>
            <RowActions actions={actions(c)} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-foreground-muted">
            <span>Issued {day(c.issued_at)}</span>
            <State c={c} />
          </div>
          <div className="text-xs">
            Expires <Expiry at={c.expires_at} />
          </div>
          <div className="font-mono text-[11px] text-foreground-muted break-all">{c.serial}</div>
        </div>
      )}
    />
  )
}
