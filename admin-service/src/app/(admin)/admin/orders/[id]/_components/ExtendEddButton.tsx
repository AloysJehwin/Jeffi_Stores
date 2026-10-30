'use client'
import { useState } from 'react'
import DatePicker from '@/components/ui/DatePicker'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { useActionToast } from '@/components/admin/kit/toast'

export default function ExtendEddButton({ orderId, currentEdd }: { orderId: string; currentEdd: string | null }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(currentEdd ?? '')
  const toast = useActionToast()
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!date) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estimated_delivery_date: date }),
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

  if (!open) {
    return (
      <RequireWrite scope="orders:write">
        <button onClick={() => setOpen(true)} className="mt-2 text-xs text-accent-500 hover:underline">
          {currentEdd ? 'Change EDD' : 'Set EDD'}
        </button>
      </RequireWrite>
    )
  }

  return (
    <RequireWrite scope="orders:write">
      <div className="mt-3 flex flex-col gap-2">
        <DatePicker value={date} onChange={setDate} className="w-full" />
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={!date || saving}
            className="control-sm bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={() => setOpen(false)}
            className="control-sm border border-border-default font-semibold text-foreground hover:bg-surface-secondary"
          >
            Cancel
          </button>
        </div>
      </div>
    </RequireWrite>
  )
}
