'use client'
import { useState } from 'react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { useActionToast } from '@/components/admin/kit/toast'

interface Props {
  orderId: string
  remittedAt: string | null
  codAmount: number
}

/**
 * COD remittance tracker — shown on delivered COD orders whose cash Delhivery
 * has collected but not yet remitted to the seller. Marks/clears cod_remitted_at
 * via PATCH /api/admin/orders/[id].
 */
export default function CodRemittanceButton({ orderId, remittedAt, codAmount }: Props) {
  const toast = useActionToast()
  const [saving, setSaving] = useState(false)
  const canWrite = useCanWrite('financial:write')

  async function setRemitted(remitted: boolean) {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cod_remitted: remitted }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to update')
      }
      window.location.reload()
    } catch (e: any) {
      toast.error(e.message)
      setSaving(false)
    }
  }

  const inr = `₹${codAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  if (remittedAt) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-green-500/40 bg-green-500/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" />
          <p className="text-sm text-foreground">
            COD {inr} remitted on{' '}
            {new Date(remittedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => setRemitted(false)}
            disabled={saving}
            className="text-xs text-foreground-muted hover:text-foreground disabled:opacity-50 transition-colors"
          >
            {saving ? '…' : 'Undo'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4 flex-shrink-0 text-amber-600" />
        <p className="text-sm font-medium text-foreground">COD {inr} not yet remitted</p>
      </div>
      {canWrite && (
        <button
          onClick={() => setRemitted(true)}
          disabled={saving}
          className="control-sm flex-shrink-0 bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Mark as remitted'}
        </button>
      )}
    </div>
  )
}
