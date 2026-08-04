'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useConfirm } from '@/contexts/ConfirmContext'

interface Props {
  entityId: string
  name: string
  subtitle?: string | null
  updatedAt: string
  editHref: string
  publishPath: string
  discardPath: string
  entityLabel?: string
}

export default function DraftRowActions({ name, subtitle, updatedAt, editHref, publishPath, discardPath, entityLabel = 'item' }: Props) {
  const router = useRouter()
  const confirm = useConfirm()
  const [publishing, setPublishing] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePublish() {
    const ok = await confirm({ message: `Apply all staged changes for "${name}" to the live ${entityLabel}?`, confirmLabel: 'Publish' })
    if (!ok) return
    setPublishing(true)
    setError(null)
    try {
      const res = await fetch(publishPath, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Publish failed'); return }
      router.refresh()
    } catch { setError('Network error') }
    finally { setPublishing(false) }
  }

  async function handleDiscard() {
    const ok = await confirm({ message: `Discard all unsaved changes for "${name}"? This cannot be undone.`, variant: 'danger', confirmLabel: 'Discard' })
    if (!ok) return
    setDiscarding(true)
    setError(null)
    try {
      const res = await fetch(discardPath, { method: 'DELETE', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Discard failed'); return }
      router.refresh()
    } catch { setError('Network error') }
    finally { setDiscarding(false) }
  }

  return (
    <div className="flex items-center justify-between px-4 py-2.5 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors">
      <Link href={editHref} className="flex-1 min-w-0 mr-4">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">{name}</p>
        {subtitle && <p className="text-xs text-amber-600 dark:text-amber-400">{subtitle}</p>}
        {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
      </Link>
      <div className="flex items-center gap-2 shrink-0">
        <p className="text-xs text-amber-500 mr-2">
          {new Date(updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
        </p>
        <button
          onClick={handlePublish}
          disabled={publishing || discarding}
          className="px-2.5 py-1 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors disabled:opacity-50"
        >
          {publishing ? '…' : 'Publish'}
        </button>
        <button
          onClick={handleDiscard}
          disabled={publishing || discarding}
          className="px-2.5 py-1 text-xs font-semibold bg-surface border border-amber-300 dark:border-amber-600 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded-md transition-colors disabled:opacity-50"
        >
          {discarding ? '…' : 'Discard'}
        </button>
      </div>
    </div>
  )
}
