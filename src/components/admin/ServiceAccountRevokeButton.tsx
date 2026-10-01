'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'

export default function ServiceAccountRevokeButton({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const { showToast, showConfirm } = useToast()
  const [loading, setLoading] = useState(false)

  async function handleRevoke() {
    const confirmed = await showConfirm({
      title: 'Revoke service account?',
      message: `"${name}" will be permanently revoked. Any systems using this certificate will immediately lose access. This cannot be undone.`,
      confirmText: 'Revoke',
      cancelText: 'Cancel',
      type: 'danger',
    })
    if (!confirmed) return

    setLoading(true)
    try {
      const res = await fetch(`/api/admin/service-accounts/${id}`, { method: 'DELETE' })
      if (res.ok) {
        showToast(`Service account "${name}" revoked`, 'success')
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        showToast(data.error || 'Failed to revoke service account', 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleRevoke}
      disabled={loading}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
    >
      {loading ? (
        <>
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Revoking…
        </>
      ) : (
        <>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
          Revoke
        </>
      )}
    </button>
  )
}
