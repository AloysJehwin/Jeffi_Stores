'use client'

import { useEffect, useState } from 'react'
import { useConfirm } from '@/contexts/ConfirmContext'

interface MfaStatus {
  mfa_enabled: boolean
  mfa_enrolled_at: string | null
  recovery_codes_remaining: number
}

export default function TwoFactorCard() {
  const confirm = useConfirm()
  const [status, setStatus] = useState<MfaStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [newCodes, setNewCodes] = useState<string[] | null>(null)
  const [error, setError] = useState('')

  async function load() {
    try {
      const res = await fetch('/api/admin/mfa/recovery-codes', { credentials: 'include' })
      const data = await res.json()
      if (res.ok) setStatus(data)
    } catch {}
  }

  useEffect(() => {
    load()
  }, [])

  async function regenerate() {
    const ok = await confirm({
      title: 'Regenerate recovery codes?',
      message: 'Your old recovery codes will stop working immediately.',
      variant: 'danger',
      confirmLabel: 'Regenerate',
    })
    if (!ok) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/mfa/recovery-codes', {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to regenerate')
      setNewCodes(data.recovery_codes || [])
      await load()
    } catch (e: any) {
      setError(e.message || 'Failed to regenerate')
    } finally {
      setLoading(false)
    }
  }

  if (!status) {
    return <div className="text-sm text-foreground-muted">Loading…</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm text-foreground">
            Status:{' '}
            {status.mfa_enabled ? (
              <span className="font-semibold text-green-600 dark:text-green-400">Enabled</span>
            ) : (
              <span className="font-semibold text-red-600 dark:text-red-400">Not enabled</span>
            )}
          </p>
          {status.mfa_enrolled_at && (
            <p className="text-xs text-foreground-muted mt-0.5">
              Enrolled on{' '}
              {new Date(status.mfa_enrolled_at).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </p>
          )}
          <p className="text-xs text-foreground-muted mt-0.5">
            Recovery codes remaining: <span className="font-semibold">{status.recovery_codes_remaining}</span>
          </p>
        </div>
        {status.mfa_enabled && (
          <button
            type="button"
            onClick={regenerate}
            disabled={loading}
            className="text-sm bg-surface-secondary hover:bg-surface-elevated border border-border-default text-foreground-secondary rounded-lg px-3 py-1.5 disabled:opacity-50"
          >
            {loading ? 'Generating…' : 'Regenerate recovery codes'}
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

      {newCodes && newCodes.length > 0 && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 space-y-2">
          <p className="text-sm font-semibold text-yellow-900 dark:text-yellow-200">
            Save these codes — they will not be shown again.
          </p>
          <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-white dark:bg-black/40 p-3 rounded">
            {newCodes.map(c => (
              <div key={c}>{c}</div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(newCodes.join('\n'))}
            className="text-xs text-accent-600 dark:text-accent-400 hover:underline"
          >
            Copy all codes
          </button>
        </div>
      )}

      {!status.mfa_enabled && (
        <p className="text-xs text-foreground-muted">
          Two-factor authentication is required for all admins. You will be prompted to set it up on next login.
        </p>
      )}
    </div>
  )
}
