'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ADMIN_SCOPES } from '@/lib/scopes'
import ScopeGrid from '@/components/admin/ScopeGrid'

interface AdminUser {
  id: string
  username: string
  first_name?: string
  last_name?: string
  role: string
  scopes: string[]
  is_active: boolean
  mfa_enabled: boolean
  last_login: string | null
  created_at: string
  certificate_status?: string
  cert_expires_at?: string
}

export default function AdminUserActions({
  admin,
  currentAdminId,
  onUpdate,
}: {
  admin: AdminUser
  currentAdminId: string
  onUpdate?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [scopes, setScopes] = useState<string[]>(admin.scopes || [])
  const [role, setRole] = useState(admin.role)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const [confirmAction, setConfirmAction] = useState<'toggle' | 'delete' | 'reset_mfa' | null>(null)

  const [resending, setResending] = useState(false)
  const [resendMsg, setResendMsg] = useState<string | null>(null)

  async function handleResendEmail() {
    setResending(true)
    setResendMsg(null)
    try {
      const res = await fetch(`/api/admin/users/${admin.id}/resend-certificate`, { method: 'POST' })
      const data = await res.json()
      setResendMsg(res.ok ? 'Email sent!' : (data.error || 'Failed'))
    } finally {
      setResending(false)
      setTimeout(() => setResendMsg(null), 4000)
    }
  }

  async function handleResetMfa() {
    if (confirmAction !== 'reset_mfa') { setConfirmAction('reset_mfa'); return }
    setConfirmAction(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${admin.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset_mfa: true }),
      })
      if (res.ok) onUpdate ? onUpdate() : router.refresh()
    } finally {
      setLoading(false)
    }
  }

  const isSelf = admin.id === currentAdminId
  const isSuperAdmin = admin.role === 'super_admin'

  function openEdit() {
    setScopes(admin.scopes || [])
    setRole(admin.role)
    setError(null)
    setEditing(true)
  }

  function toggleScope(key: string) {
    setScopes(prev => prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key])
  }

  async function handleSave() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${admin.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopes, role }),
      })
      if (res.ok) {
        setEditing(false)
        onUpdate ? onUpdate() : router.refresh()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to save')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleActive() {
    if (confirmAction !== 'toggle') { setConfirmAction('toggle'); return }
    setConfirmAction(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${admin.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !admin.is_active }),
      })
      if (res.ok) onUpdate ? onUpdate() : router.refresh()
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (confirmAction !== 'delete') { setConfirmAction('delete'); return }
    setConfirmAction(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${admin.id}`, {
        method: 'DELETE',
      })
      if (res.ok) onUpdate ? onUpdate() : router.refresh()
    } finally {
      setLoading(false)
    }
  }

  const allSelected = scopes.length === ADMIN_SCOPES.length

  return (
    <>
      <div className="flex items-center gap-1">
        {!isSuperAdmin && !isSelf && (
          <>
            {confirmAction === 'toggle' ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-foreground-secondary">{admin.is_active ? 'Deactivate' : 'Activate'}?</span>
                <button type="button" onClick={handleToggleActive} disabled={loading} className={`text-xs font-medium ${admin.is_active ? 'text-red-600 hover:text-red-700' : 'text-green-600 hover:text-green-700'}`}>
                  {loading ? '…' : 'Yes'}
                </button>
                <button type="button" onClick={() => setConfirmAction(null)} className="text-xs text-foreground-muted hover:text-foreground">No</button>
              </div>
            ) : confirmAction === 'delete' ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-foreground-secondary">Delete?</span>
                <button type="button" onClick={handleDelete} disabled={loading} className="text-xs font-medium text-red-600 hover:text-red-700">
                  {loading ? '…' : 'Yes'}
                </button>
                <button type="button" onClick={() => setConfirmAction(null)} className="text-xs text-foreground-muted hover:text-foreground">No</button>
              </div>
            ) : confirmAction === 'reset_mfa' ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-foreground-secondary">Reset 2FA?</span>
                <button type="button" onClick={handleResetMfa} disabled={loading} className="text-xs font-medium text-amber-600 hover:text-amber-700">
                  {loading ? '…' : 'Yes'}
                </button>
                <button type="button" onClick={() => setConfirmAction(null)} className="text-xs text-foreground-muted hover:text-foreground">No</button>
              </div>
            ) : (
              <>
                {/* Edit */}
                <button
                  type="button"
                  onClick={openEdit}
                  title="Edit scopes"
                  className="p-1.5 rounded-lg text-foreground-secondary hover:text-accent-500 hover:bg-surface-secondary transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>

                {/* Resend email */}
                <button
                  type="button"
                  onClick={handleResendEmail}
                  disabled={resending}
                  title={resendMsg ?? 'Resend certificate email'}
                  className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                    resendMsg === 'Email sent!'
                      ? 'text-green-500'
                      : resendMsg
                        ? 'text-red-500'
                        : 'text-foreground-secondary hover:text-blue-500 hover:bg-surface-secondary'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </button>

                {admin.mfa_enabled && (
                  <button
                    type="button"
                    onClick={handleResetMfa}
                    disabled={loading}
                    title="Reset 2FA — forces re-enroll on next login"
                    className="p-1.5 rounded-lg text-foreground-secondary hover:text-amber-500 hover:bg-surface-secondary transition-colors disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </button>
                )}

                {/* Deactivate / Activate */}
                <button
                  type="button"
                  onClick={handleToggleActive}
                  disabled={loading}
                  title={admin.is_active ? 'Deactivate' : 'Activate'}
                  className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                    admin.is_active
                      ? 'text-foreground-secondary hover:text-amber-500 hover:bg-surface-secondary'
                      : 'text-foreground-secondary hover:text-green-500 hover:bg-surface-secondary'
                  }`}
                >
                  {admin.is_active ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                </button>

                {/* Delete */}
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={loading}
                  title="Delete"
                  className="p-1.5 rounded-lg text-foreground-secondary hover:text-red-500 hover:bg-surface-secondary transition-colors disabled:opacity-50"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </>
            )}
          </>
        )}
        {isSelf && <span className="text-xs text-foreground-muted">You</span>}
        {isSuperAdmin && !isSelf && <span className="text-xs text-foreground-muted">Super Admin</span>}
      </div>

      {editing && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setEditing(false) }}
        >
          <div className="bg-surface-elevated rounded-2xl shadow-2xl border border-border-default w-full max-w-lg flex flex-col max-h-[90vh]">

            <div className="flex items-center justify-between px-6 py-4 border-b border-border-default shrink-0">
              <div>
                <h3 className="font-semibold text-foreground text-base">Edit admin</h3>
                <p className="text-xs text-foreground-muted mt-0.5">{admin.first_name && admin.last_name ? `${admin.first_name} ${admin.last_name}` : admin.username}</p>
              </div>
              <button type="button" onClick={() => setEditing(false)} className="text-foreground-muted hover:text-foreground p-1.5 rounded-lg hover:bg-surface-secondary">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Role</label>
                <div className="flex gap-2">
                  {(['admin', 'moderator'] as const).map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        role === r
                          ? 'border-accent-500 bg-accent-500/10 text-accent-600 dark:text-accent-400'
                          : 'border-border-default bg-surface text-foreground hover:bg-surface-secondary'
                      }`}
                    >
                      <span className="capitalize">{r}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-foreground">
                    Scopes
                    <span className="ml-2 text-xs font-normal text-foreground-muted">{scopes.length} of {ADMIN_SCOPES.length} selected</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setScopes(allSelected ? [] : ADMIN_SCOPES.map(s => s.key))}
                    className="text-xs text-accent-500 hover:text-accent-600 font-medium"
                  >
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <ScopeGrid selected={scopes} onToggle={toggleScope} variant="button" />
              </div>

              {error && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border-default shrink-0">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-4 py-2 rounded-lg text-sm text-foreground-secondary bg-surface-secondary hover:bg-border-default transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={loading}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-accent-500 hover:bg-accent-600 text-white disabled:opacity-50 transition-colors"
              >
                {loading ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
