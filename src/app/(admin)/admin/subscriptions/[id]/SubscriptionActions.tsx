'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'

type Action = 'cancel_now' | 'cancel_at_end' | 'pause' | 'resume' | 'sync'

const CONFIRM: Partial<Record<Action, { title: string; message: string; label: string; danger?: boolean }>> = {
  cancel_now: {
    title: 'Cancel immediately',
    message: 'Cancel this subscription now? No further charges will be made and the mandate ends today.',
    label: 'Cancel now',
    danger: true,
  },
  cancel_at_end: {
    title: 'Cancel at cycle end',
    message: 'Cancel this subscription at the end of the current cycle?',
    label: 'Schedule cancel',
    danger: true,
  },
  pause: { title: 'Pause subscription', message: 'Pause collections for this subscription?', label: 'Pause' },
  resume: { title: 'Resume subscription', message: 'Resume collections for this subscription?', label: 'Resume' },
}

export default function SubscriptionActions({
  id,
  status,
  cancelAtCycleEnd,
}: {
  id: string
  status: string
  cancelAtCycleEnd: boolean
}) {
  const [busy, setBusy] = useState<Action | null>(null)
  const router = useRouter()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const canWrite = useCanWrite('subscriptions:write')
  if (!canWrite) return null

  const live = ['active', 'authenticated', 'pending', 'halted', 'paused'].includes(status)
  const buttons: { action: Action; label: string; show: boolean; cls: string }[] = [
    { action: 'sync', label: 'Sync from Razorpay', show: true, cls: 'border border-border-default' },
    { action: 'pause', label: 'Pause', show: status === 'active', cls: 'border border-border-default' },
    { action: 'resume', label: 'Resume', show: status === 'paused', cls: 'border border-border-default' },
    {
      action: 'cancel_at_end',
      label: 'Cancel at cycle end',
      show: live && !cancelAtCycleEnd,
      cls: 'border border-red-300 text-red-600',
    },
    { action: 'cancel_now', label: 'Cancel now', show: live, cls: 'bg-red-600 text-white' },
  ]

  const run = async (action: Action) => {
    const c = CONFIRM[action]
    if (c) {
      const ok = await confirm({
        title: c.title,
        message: c.message,
        confirmLabel: c.label,
        cancelLabel: 'Back',
        variant: c.danger ? 'danger' : undefined,
      })
      if (!ok) return
    }
    setBusy(action)
    const res = await fetch(`/api/admin/subscriptions/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) return showToast(data.error || 'Action failed', 'error')
    showToast('Subscription updated', 'success')
    router.refresh()
  }

  return (
    <div className="flex flex-wrap gap-2">
      {buttons
        .filter(b => b.show)
        .map(b => (
          <button
            key={b.action}
            onClick={() => run(b.action)}
            disabled={busy !== null}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 ${b.cls}`}
          >
            {busy === b.action ? 'Working…' : b.label}
          </button>
        ))}
    </div>
  )
}
