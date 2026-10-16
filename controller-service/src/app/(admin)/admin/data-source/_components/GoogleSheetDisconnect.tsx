'use client'

import { useState } from 'react'
import { Unplug } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'

export default function GoogleSheetDisconnect({
  onDone,
  disabled,
}: {
  onDone: (result: { kind: 'ok' | 'err'; text: string }) => void
  disabled?: boolean
}) {
  const canWrite = useCanWrite('products')
  const { showConfirm } = useToast()
  const [working, setWorking] = useState(false)
  if (!canWrite) return null

  const disconnect = async () => {
    const ok = await showConfirm({
      title: 'Disconnect Google Sheet?',
      message: 'Syncing stops. Products synced from the sheet stay in your store and become manually managed, so a sheet you connect later only ever manages the rows it lists.',
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
          ? { kind: 'ok', text: `Google Sheet disconnected. ${body.released ?? 0} synced product(s) are now managed manually.` }
          : { kind: 'err', text: body.error || `Could not disconnect (${res.status}).` }
      )
    } catch {
      onDone({ kind: 'err', text: 'Disconnect failed: the connection dropped. Try again.' })
    } finally {
      setWorking(false)
    }
  }

  const busy = working || disabled
  return (
    <button
      type="button"
      onClick={disconnect}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 whitespace-nowrap ${busy ? 'opacity-60 cursor-wait' : 'hover:bg-red-500/10'}`}
    >
      <Unplug className="w-4 h-4" /> {working ? 'Disconnecting...' : 'Disconnect'}
    </button>
  )
}
