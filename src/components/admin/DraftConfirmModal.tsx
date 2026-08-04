'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'

interface Props {
  productId: string
  productName: string
  productSku: string | null
  existingDraftId: string | null
  backUrl?: string
  apPrefix?: string
  entity?: string            // API + route segment; defaults to 'products'
  onClose?: () => void  // when provided, Cancel calls this instead of router.back()
}

export default function DraftConfirmModal({ productId, productName, productSku, existingDraftId, backUrl, apPrefix = '', entity = 'products', onClose }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mounted, setMounted] = useState(false)

  // Mount portal after hydration to avoid SSR/hydration mismatch
  useEffect(() => { setMounted(true) }, [])

  async function createDraft() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/${entity}/${productId}/draft`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        // 409 = draft already exists — reload this same edit page to show the draft form
        if (res.status === 409) {
          router.push(`${apPrefix}/admin/${entity}/edit/${productId}${backUrl ? `?back=${encodeURIComponent(backUrl)}` : ''}`)
          return
        }
        setError(data.error || 'Failed to create draft')
        return
      }
      // Draft created — reload the same edit page (original record id); it will detect the draft
      router.push(`${apPrefix}/admin/${entity}/edit/${productId}${backUrl ? `?back=${encodeURIComponent(backUrl)}` : ''}`)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function goBack() {
    if (onClose) { onClose(); return }
    if (backUrl) router.push(backUrl)
    else router.push(`${apPrefix}/admin/${entity}`)
  }

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-surface-elevated rounded-2xl shadow-2xl border border-border-default w-full max-w-md p-6">
        {/* Icon */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-accent-600 dark:text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">Create draft to edit</h2>
            <p className="text-xs text-foreground-muted">Edits are staged as a draft</p>
          </div>
        </div>

        {/* Product info */}
        <div className="bg-surface-secondary rounded-xl border border-border-default px-4 py-3 mb-5">
          <p className="text-sm font-semibold text-foreground leading-tight">{productName || 'Product'}</p>
          {productSku && <p className="text-xs text-foreground-muted mt-1">SKU: {productSku}</p>}
          <div className="flex items-center gap-1.5 mt-2">
            <span className="text-xs text-foreground-muted">A draft copy will be created — the original stays unchanged until you publish.</span>
          </div>
        </div>

        {/* Already has draft */}
        {existingDraftId && (
          <div className="mb-4 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            A draft already exists for this product. Clicking &quot;Edit Draft&quot; will open it.
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        <p className="text-sm text-foreground-secondary mb-5">
          Your edits will be saved as a draft. The live product stays unchanged until you publish.
        </p>

        <div className="flex gap-3">
          <button
            onClick={goBack}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-xl border border-border-default text-sm font-semibold text-foreground-secondary hover:bg-surface-secondary transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={existingDraftId ? () => router.push(`${apPrefix}/admin/${entity}/edit/${productId}${backUrl ? `?back=${encodeURIComponent(backUrl)}` : ''}`) : createDraft}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-xl bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Creating…
              </>
            ) : existingDraftId ? 'Edit Draft' : 'Create Draft & Edit'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
