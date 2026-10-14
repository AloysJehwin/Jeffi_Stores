'use client'

import { useState } from 'react'
import { RequireWrite } from '@/contexts/AdminScopesContext'

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
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const act = async (action: 'revoke' | 'grant', orderItemIds?: string[]) => {
    const key = action + (orderItemIds?.[0] ?? '')
    setBusy(key)
    setError(null)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/entitlements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, orderItemIds }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to update access')
        return
      }
      setLines(data.entitlements)
    } catch {
      setError('Failed to update access')
    } finally {
      setBusy(null)
    }
  }

  const anyInactive = lines.some(l => l.status !== 'active')

  return (
    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
      <div className="px-6 py-4 border-b border-border-default flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-foreground">Digital Access</h2>
        {anyInactive && (
          <RequireWrite scope="orders:write">
            <button
              onClick={() => act('grant')}
              disabled={busy !== null}
              className="px-3 py-1.5 text-xs font-semibold rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 hover:bg-green-200 disabled:opacity-50"
            >
              {busy === 'grant' ? 'Granting…' : 'Re-grant access'}
            </button>
          </RequireWrite>
        )}
      </div>
      <div className="divide-y divide-border-default">
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
                  className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 disabled:opacity-50"
                >
                  {busy === 'revoke' + l.order_item_id ? 'Revoking…' : 'Revoke'}
                </button>
              </RequireWrite>
            )}
          </div>
        ))}
      </div>
      {error && <p className="px-6 pb-3 text-xs text-red-600">{error}</p>}
    </div>
  )
}
