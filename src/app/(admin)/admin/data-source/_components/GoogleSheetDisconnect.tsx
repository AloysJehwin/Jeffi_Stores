'use client'

import { useState } from 'react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'

export default function GoogleSheetDisconnect({
  onDone,
}: {
  onDone: (result: { kind: 'ok' | 'err'; text: string }) => void
}) {
  const canWrite = useCanWrite('products')
  const { showConfirm } = useToast()
  const [working, setWorking] = useState(false)
  if (!canWrite) return null

  const disconnect = async () => {
    const ok = await showConfirm({
      title: 'Disconnect Google Sheet?',
      message:
        'Syncing stops. Products synced from the sheet stay in your store and become manually managed, so a sheet you connect later will not remove them.',
      confirmText: 'Disconnect',
      cancelText: 'Cancel',
      type: 'warning',
    })
    if (!ok) return
    setWorking(true)
    try {
      const res = await fetch('/api/admin/data-source/google/disconnect', { method: 'POST', credentials: 'include' })
      const body = await res.json().catch(() => ({}))
      onDone(
        res.ok
          ? {
              kind: 'ok',
              text: `Google Sheet disconnected. ${body.released ?? 0} synced product(s) are now managed manually.`,
            }
          : { kind: 'err', text: body.error || `Disconnect failed (${res.status})` }
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <button
      onClick={disconnect}
      disabled={working}
      className={`inline-flex items-center rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 ${working ? 'opacity-60 cursor-wait' : 'hover:bg-red-50 dark:hover:bg-red-900/20'}`}
    >
      {working ? 'Disconnecting…' : 'Disconnect'}
    </button>
  )
}
