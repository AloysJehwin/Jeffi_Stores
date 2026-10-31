'use client'

import { useState } from 'react'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { Card } from '@/components/admin/kit/layout'
import { useActionToast } from '@/components/admin/kit/toast'

export interface DigitalAccessLine {
  order_item_id: string
  product_name: string
  status: string | null
  granted_at: string | null
  revoked_at: string | null
  revoke_reason: string | null
  access_expires_at: string | null
}

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '—'

export default function DigitalAccessCard({ orderId, initial }: { orderId: string; initial: DigitalAccessLine[] }) {
  const [lines, setLines] = useState(initial)
  const toast = useActionToast()
  const [busy, setBusy] = useState<string | null>(null)

  const act = async (action: 'revoke' | 'grant', orderItemIds?: string[]) => {
    const key = action + (orderItemIds?.[0] ?? '')
    setBusy(key)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/entitlements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, orderItemIds }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to update access')
        return
      }
      setLines(data.entitlements)
      toast.success(action === 'grant' ? 'Access granted.' : 'Access revoked.')
    } catch {
      toast.error('Failed to update access')
    } finally {
      setBusy(null)
    }
  }

  const anyInactive = lines.some(l => l.status !== 'active')

  return (
    <Card
      title="Digital Access"
      flush
      action={
        anyInactive && (
          <RequireWrite scope="orders:write">
            <button type="button" onClick={() => act('grant')} disabled={busy !== null} className="control-sm border border-green-500/40 font-semibold text-green-700 hover:bg-green-500/10 disabled:opacity-50 dark:text-green-400">
              {busy === 'grant' ? 'Granting...' : 'Re-grant access'}
            </button>
          </RequireWrite>
        )
      }
    >
      <div className="divide-y divide-border-default border-t border-border-default">
        {lines.map(l => (
          <div key={l.order_item_id} className="px-6 py-3 flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium text-foreground truncate">{l.product_name}</p>
              <p className="text-xs text-foreground-muted mt-0.5">
                {l.status === 'active' ? (
                  <span className="text-green-600 dark:text-green-400 font-medium">Active</span>
                ) : l.status === 'revoked' ? (
                  <span className="text-red-600 dark:text-red-400 font-medium">
                    Revoked{l.revoke_reason ? ` (${l.revoke_reason})` : ''}
                  </span>
                ) : (
                  <span>{l.status ?? 'Not granted'}</span>
                )}
                {' · granted '}
                {fmt(l.granted_at)}
                {l.revoked_at && ` · revoked ${fmt(l.revoked_at)}`}
                {l.access_expires_at && ` · expires ${fmt(l.access_expires_at)}`}
              </p>
            </div>
            {l.status === 'active' && (
              <RequireWrite scope="orders:write">
                <button
                  onClick={() => act('revoke', [l.order_item_id])}
                  disabled={busy !== null}
                  type="button"
                  className="control-sm shrink-0 border border-red-500/40 font-semibold text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                >
                  {busy === 'revoke' + l.order_item_id ? 'Revoking…' : 'Revoke'}
                </button>
              </RequireWrite>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}
