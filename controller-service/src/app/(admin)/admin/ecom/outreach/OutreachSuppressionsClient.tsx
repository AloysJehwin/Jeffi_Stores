'use client'

import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import IconButton from '@/components/ui/IconButton'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { api, btnPrimary, inputCls, when } from '@/components/admin/kit/core'
import { Card } from '@/components/admin/kit/layout'
import { useActionToast } from '@/components/admin/kit/toast'
import type { OutreachSuppression } from '@controller/lib/outreach/types'
import { API } from './shared'

export default function OutreachSuppressionsClient() {
  const canWrite = useCanWrite('ecom_outreach:write')
  const toast = useActionToast()
  const [rows, setRows] = useState<OutreachSuppression[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (search: string) => {
    const { ok, data } = await api<{ rows: OutreachSuppression[]; total: number }>(`${API}/suppressions${search ? `?q=${encodeURIComponent(search)}` : ''}`)
    if (!ok) return setError(data.error || 'Could not load the suppression list')
    setError(null)
    setRows(data.rows)
    setTotal(data.total)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => load(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q, load])

  async function add() {
    setBusy(true)
    const { ok, data } = await api(`${API}/suppressions`, { method: 'POST', json: { phone: phone.trim(), ...(reason.trim() ? { reason: reason.trim() } : {}) } })
    setBusy(false)
    if (!ok) return toast.error(data.error || 'Could not suppress that number')
    toast.success('Number suppressed')
    setPhone('')
    setReason('')
    load(q.trim())
  }

  async function remove(p: string) {
    const { ok, data } = await api(`${API}/suppressions`, { method: 'DELETE', json: { phone: p } })
    if (!ok) return toast.error(data.error || 'Could not remove it')
    toast.success('Suppression lifted')
    load(q.trim())
  }

  return (
    <div className="space-y-5">
      <Card title="Add a number" hint="Suppressed numbers are never called or messaged. Live contacts on the number move to Suppressed.">
        <div className="flex flex-col sm:flex-row gap-3">
          <input aria-label="Phone" className={`${inputCls} sm:w-56`} placeholder="+91 98765 43210" value={phone} disabled={!canWrite} onChange={e => setPhone(e.target.value)} />
          <input aria-label="Reason" className={inputCls} placeholder="Reason (optional)" value={reason} disabled={!canWrite} onChange={e => setReason(e.target.value)} />
          <button type="button" className={btnPrimary} disabled={!canWrite || busy || !phone.trim()} onClick={add}>
            Suppress
          </button>
        </div>
      </Card>

      <input aria-label="Search suppressions" className={`${inputCls} sm:max-w-sm`} placeholder="Search by number or reason" value={q} onChange={e => setQ(e.target.value)} />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!rows && !error && <div className="h-32 rounded-xl border border-border-default bg-surface-elevated animate-pulse" />}
      {rows && !rows.length && <div className="rounded-xl border border-border-default bg-surface-elevated p-6 text-center text-sm text-foreground-muted">No suppressed numbers.</div>}
      {rows && !!rows.length && (
        <div className="rounded-xl border border-border-default bg-surface-elevated">
          <div className="px-4 py-2 text-xs text-foreground-muted border-b border-border-default">{total.toLocaleString('en-IN')} suppressed</div>
          <ul className="divide-y divide-border-default/60">
            {rows.map(r => (
              <li key={r.phone} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-foreground tabular-nums">{r.phone}</div>
                  <div className="text-xs text-foreground-muted truncate">
                    {r.reason || 'No reason'} · {r.source || 'unknown'} · {when(r.created_at)}
                  </div>
                </div>
                {canWrite && <IconButton icon={Trash2} label="Remove suppression" variant="danger" onClick={() => remove(r.phone)} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
