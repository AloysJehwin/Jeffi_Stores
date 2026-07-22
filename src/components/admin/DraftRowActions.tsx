'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useConfirm } from '@/contexts/ConfirmContext'

interface Props {
  productId: string
  name: string
  sku: string | null
  updatedAt: string
  editHref: string
}

export default function DraftRowActions({ productId, name, sku, updatedAt, editHref }: Props) {
  const router = useRouter()
  const confirm = useConfirm()
  const [publishing, setPublishing] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePublish() {
    const ok = await confirm({ message: `Apply all staged changes for "${name}" to the live product?`, confirmLabel: 'Publish' })
    if (!ok) return
    setPublishing(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/products/${productId}/publish`, { method: 'POST', credentials: 'include' })
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
      const res = await fetch(`/api/admin/products/${productId}/draft`, { method: 'DELETE', credentials: 'include' })
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
        {sku && <p className="text-xs text-amber-600 dark:text-amber-400">{sku}</p>}
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


interface Props {
  productId: string
  name: string
  sku: string | null
  updatedAt: string
  editHref: string
}

function ConfirmDialog({ title, message, confirmLabel, confirmClass, onConfirm, onCancel }: {
  title: string
  message: string
  confirmLabel: string
  confirmClass: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return createPortal(
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-surface-elevated rounded-xl border border-border-default shadow-xl w-full max-w-sm p-6">
        <h3 className="text-base font-semibold text-foreground mb-2">{title}</h3>
        <p className="text-sm text-foreground-secondary mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium border border-border-default rounded-lg text-foreground hover:bg-surface-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function DraftRowActions({ productId, name, sku, updatedAt, editHref }: Props) {
  const router = useRouter()
  const [publishing, setPublishing] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'publish' | 'discard' | null>(null)

  async function doPublish() {
    setDialog(null)
    setPublishing(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/products/${productId}/publish`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Publish failed'); return }
      router.refresh()
    } catch { setError('Network error') }
    finally { setPublishing(false) }
  }

  async function doDiscard() {
    setDialog(null)
    setDiscarding(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/products/${productId}/draft`, { method: 'DELETE', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Discard failed'); return }
      router.refresh()
    } catch { setError('Network error') }
    finally { setDiscarding(false) }
  }

  return (
    <>
      {dialog === 'publish' && (
        <ConfirmDialog
          title="Publish Draft"
          message={`Apply all staged changes for "${name}" to the live product?`}
          confirmLabel="Publish"
          confirmClass="bg-green-600 hover:bg-green-700"
          onConfirm={doPublish}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'discard' && (
        <ConfirmDialog
          title="Discard Draft"
          message={`Discard all unsaved changes for "${name}"? This cannot be undone.`}
          confirmLabel="Discard"
          confirmClass="bg-red-600 hover:bg-red-700"
          onConfirm={doDiscard}
          onCancel={() => setDialog(null)}
        />
      )}
      <div className="flex items-center justify-between px-4 py-2.5 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors">
        <Link href={editHref} className="flex-1 min-w-0 mr-4">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">{name}</p>
          {sku && <p className="text-xs text-amber-600 dark:text-amber-400">{sku}</p>}
          {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          <p className="text-xs text-amber-500 mr-2">
            {new Date(updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </p>
          <button
            onClick={() => setDialog('publish')}
            disabled={publishing || discarding}
            className="px-2.5 py-1 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors disabled:opacity-50"
          >
            {publishing ? '…' : 'Publish'}
          </button>
          <button
            onClick={() => setDialog('discard')}
            disabled={publishing || discarding}
            className="px-2.5 py-1 text-xs font-semibold bg-surface border border-amber-300 dark:border-amber-600 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded-md transition-colors disabled:opacity-50"
          >
            {discarding ? '…' : 'Discard'}
          </button>
        </div>
      </div>
    </>
  )
}
