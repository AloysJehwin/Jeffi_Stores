'use client'
import { useState } from 'react'
import DatePicker from '@/components/ui/DatePicker'
import { RequireWrite } from '@/contexts/AdminScopesContext'

export default function ExtendEddButton({ orderId, currentEdd }: { orderId: string; currentEdd: string | null }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(currentEdd ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!date) return
    setSaving(true)
    setError('')
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
      setError(e.message)
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <RequireWrite scope="orders:write">
        <button
          onClick={() => setOpen(true)}
          className="mt-2 text-xs text-accent-500 hover:underline"
        >
          {currentEdd ? 'Change EDD' : 'Set EDD'}
        </button>
      </RequireWrite>
    )
  }

  return (
    <RequireWrite scope="orders:write">
    <div className="mt-3 flex flex-col gap-2">
      <DatePicker
        value={date}
        onChange={setDate}
        className="w-full"
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={!date || saving}
          className="px-3 py-1 text-xs font-semibold rounded-lg bg-accent-500 hover:bg-accent-600 text-white disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={() => { setOpen(false); setError('') }}
          className="px-3 py-1 text-xs font-semibold rounded-lg bg-surface-secondary hover:bg-surface-secondary/70 text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
    </RequireWrite>
  )
}
